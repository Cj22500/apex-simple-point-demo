"""Point cloud file I/O: LAS/LAZ (laspy + lazrs), E57 (pye57), PLY (plyfile), PTS, XYZ.

All readers return a PointSet with float64 coordinates. Text writers use 4 decimals (0.1 mm);
LAS/LAZ is written with scale 0.0001 (0.1 mm quantisation) and an integer-metre offset.
"""
from __future__ import annotations

from pathlib import Path

import laspy
import numpy as np
from plyfile import PlyData, PlyElement

from app.core.pointset import PointSet

SUPPORTED = (".las", ".laz", ".e57", ".ply", ".pts", ".xyz", ".txt", ".csv")
LAS_SCALE = 0.0001


class UnsupportedFormat(ValueError):
    pass


def detect_format(path: Path) -> str:
    path = Path(path)
    with open(path, "rb") as f:
        head = f.read(16)
    if head.startswith(b"LASF"):
        return "laz" if path.suffix.lower() == ".laz" else "las"
    if head.startswith(b"ASTM-E57"):
        return "e57"
    if head.startswith(b"ply"):
        return "ply"
    ext = path.suffix.lower()
    if ext == ".pts":
        return "pts"
    if ext in (".xyz", ".txt", ".csv"):
        return "xyz"
    raise UnsupportedFormat(f"cannot detect point cloud format of {path.name}")


def read_points(path: str | Path) -> PointSet:
    path = Path(path)
    fmt = detect_format(path)
    return {"las": _read_las, "laz": _read_las, "e57": _read_e57, "ply": _read_ply, "pts": _read_pts, "xyz": _read_xyz}[fmt](path)


def write_points(ps: PointSet, path: str | Path) -> Path:
    path = Path(path)
    ext = path.suffix.lower()
    writers = {".las": _write_las, ".laz": _write_las, ".e57": _write_e57, ".ply": _write_ply, ".pts": _write_pts, ".xyz": _write_xyz}
    if ext not in writers:
        raise UnsupportedFormat(f"cannot write {ext}")
    writers[ext](ps, path)
    return path


# ---------------------------------------------------------------- LAS / LAZ
def _to8(c16: np.ndarray) -> np.ndarray:
    c16 = np.asarray(c16)
    # LAS stores 16-bit colour; some writers put 8-bit values in 16-bit fields.
    return (c16 >> 8).astype(np.uint8) if c16.max(initial=0) > 255 else c16.astype(np.uint8)


def _read_las(path: Path) -> PointSet:
    las = laspy.read(path)
    xyz = np.column_stack([np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)]).astype(np.float64)
    dims = set(las.point_format.dimension_names)
    rgb = np.column_stack([_to8(las.red), _to8(las.green), _to8(las.blue)]) if "red" in dims else None
    extra = {}
    for name in las.point_format.extra_dimension_names:
        extra[name] = np.asarray(las[name])
    crs = "unknown"
    try:
        parsed = las.header.parse_crs()
        if parsed is not None:
            crs = parsed.to_string()
    except Exception:  # noqa: BLE001  (CRS VLRs are often malformed; keep reading points)
        pass
    return PointSet(xyz, np.asarray(las.intensity), rgb, np.asarray(las.classification), extra, crs=crs)


def _write_las(ps: PointSet, path: Path) -> None:
    header = laspy.LasHeader(point_format=7, version="1.4")
    header.scales = np.array([LAS_SCALE] * 3)
    lo, _ = ps.bounds() if len(ps) else (np.zeros(3), None)
    header.offsets = np.floor(lo)
    for name, arr in ps.extra.items():
        header.add_extra_dim(laspy.ExtraBytesParams(name=name, type=arr.dtype))
    try:
        from pyproj import CRS

        header.add_crs(CRS.from_string("EPSG:6677+6695"))
    except Exception:  # noqa: BLE001  (CRS is metadata only; never block a write)
        pass
    las = laspy.LasData(header)
    las.x, las.y, las.z = ps.xyz[:, 0], ps.xyz[:, 1], ps.xyz[:, 2]
    if ps.intensity is not None:
        las.intensity = ps.intensity
    if ps.rgb is not None:
        rgb16 = ps.rgb.astype(np.uint16) * 257
        las.red, las.green, las.blue = rgb16[:, 0], rgb16[:, 1], rgb16[:, 2]
    if ps.classification is not None:
        las.classification = ps.classification
    for name, arr in ps.extra.items():
        las[name] = arr
    las.write(path)


# ---------------------------------------------------------------- E57
def _read_e57(path: Path) -> PointSet:
    import pye57

    e57 = pye57.E57(str(path))
    parts = []
    for i in range(e57.scan_count):
        d = e57.read_scan(i, ignore_missing_fields=True, colors=True, intensity=True, transform=True)
        parts.append(d)
    xyz = np.concatenate([np.column_stack([d["cartesianX"], d["cartesianY"], d["cartesianZ"]]) for d in parts])
    inten = None
    if all("intensity" in d for d in parts):
        raw = np.concatenate([d["intensity"] for d in parts]).astype(np.float64)
        inten = np.clip(np.round(raw * 65535.0 if raw.max(initial=0) <= 1.0 else raw), 0, 65535).astype(np.uint16)
    rgb = None
    if all("colorRed" in d for d in parts):
        rgb = np.concatenate([np.column_stack([d["colorRed"], d["colorGreen"], d["colorBlue"]]) for d in parts]).astype(np.uint8)
    return PointSet(xyz, inten, rgb)


def _write_e57(ps: PointSet, path: Path) -> None:
    """pye57 stores cartesian values as float32. At plane-coordinate scale (~4e4 m) that is ~2 mm
    (found by test_io). So points are written relative to a float64 origin carried in the scan
    pose translation; readers applying the pose (transform=True) get float64 coordinates back."""
    import pye57

    origin = np.floor(ps.xyz.min(axis=0)) if len(ps) else np.zeros(3)
    local = ps.xyz - origin
    data = {"cartesianX": local[:, 0], "cartesianY": local[:, 1], "cartesianZ": local[:, 2]}
    if ps.intensity is not None:
        data["intensity"] = ps.intensity.astype(np.float64) / 65535.0
    if ps.rgb is not None:
        data["colorRed"], data["colorGreen"], data["colorBlue"] = (ps.rgb[:, i].astype(np.uint8) for i in range(3))
    e57 = pye57.E57(str(path), mode="w")
    e57.write_scan_raw(data, rotation=np.array([1.0, 0.0, 0.0, 0.0]), translation=origin)
    e57.close()


# ---------------------------------------------------------------- PLY
_PLY_INTENSITY_NAMES = ("intensity", "scalar_intensity", "scalar_Intensity")


def _read_ply(path: Path) -> PointSet:
    v = PlyData.read(str(path))["vertex"].data
    names = v.dtype.names
    xyz = np.column_stack([v["x"], v["y"], v["z"]]).astype(np.float64)
    rgb = np.column_stack([v["red"], v["green"], v["blue"]]).astype(np.uint8) if "red" in names else None
    inten = None
    for n in _PLY_INTENSITY_NAMES:
        if n in names:
            inten = np.asarray(v[n]).astype(np.uint16)
            break
    cls = np.asarray(v["classification"]).astype(np.uint8) if "classification" in names else None
    return PointSet(xyz, inten, rgb, cls)


def _write_ply(ps: PointSet, path: Path) -> None:
    fields = [("x", "f8"), ("y", "f8"), ("z", "f8")]  # f8: float32 would lose mm at plane-coordinate scale
    if ps.rgb is not None:
        fields += [("red", "u1"), ("green", "u1"), ("blue", "u1")]
    if ps.intensity is not None:
        fields += [("intensity", "u2")]
    if ps.classification is not None:
        fields += [("classification", "u1")]
    arr = np.empty(len(ps), dtype=fields)
    arr["x"], arr["y"], arr["z"] = ps.xyz.T
    if ps.rgb is not None:
        arr["red"], arr["green"], arr["blue"] = ps.rgb.T
    if ps.intensity is not None:
        arr["intensity"] = ps.intensity
    if ps.classification is not None:
        arr["classification"] = ps.classification
    PlyData([PlyElement.describe(arr, "vertex")], byte_order="<").write(str(path))


# ---------------------------------------------------------------- PTS / XYZ (text)
def _parse_text(path: Path, skip_first_line: bool) -> np.ndarray:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    if skip_first_line:
        lines = lines[1:]
    lines = [ln for ln in lines if ln.strip() and not ln.lstrip().startswith(("#", "//"))]
    if not lines:
        return np.empty((0, 3))
    ncol = len(lines[0].replace(",", " ").replace(";", " ").split())
    flat = np.array(" ".join(lines).replace(",", " ").replace(";", " ").split(), dtype=np.float64)
    if flat.size % ncol:
        raise ValueError(f"{path.name}: inconsistent column count (expected {ncol})")
    return flat.reshape(-1, ncol)


def _read_pts(path: Path) -> PointSet:
    """Leica PTS: first line = point count; rows `x y z [i] [r g b]`, intensity in -2048..2047."""
    a = _parse_text(path, skip_first_line=True)
    inten = np.clip(np.round((a[:, 3] + 2048) / 4095 * 65535), 0, 65535).astype(np.uint16) if a.shape[1] >= 4 else None
    rgb = a[:, 4:7].astype(np.uint8) if a.shape[1] >= 7 else None
    return PointSet(a[:, :3], inten, rgb)


def _write_pts(ps: PointSet, path: Path) -> None:
    cols = [ps.xyz]
    fmt = ["%.4f", "%.4f", "%.4f"]
    inten = ps.intensity if ps.intensity is not None else np.full(len(ps), 32768, np.uint16)
    cols.append((np.round(inten.astype(np.float64) / 65535 * 4095) - 2048)[:, None])
    fmt.append("%d")
    if ps.rgb is not None:
        cols.append(ps.rgb.astype(np.float64))
        fmt += ["%d"] * 3
    with open(path, "w", encoding="ascii", newline="\n") as f:
        f.write(f"{len(ps)}\n")
        np.savetxt(f, np.hstack(cols), fmt=fmt, delimiter=" ")


def _read_xyz(path: Path) -> PointSet:
    """`x y z [r g b]` or `x y z [intensity]`; space, comma or semicolon separated."""
    a = _parse_text(path, skip_first_line=False)
    rgb = a[:, 3:6].astype(np.uint8) if a.shape[1] >= 6 else None
    inten = a[:, 3].astype(np.uint16) if a.shape[1] == 4 else None
    return PointSet(a[:, :3], inten, rgb)


def _write_xyz(ps: PointSet, path: Path) -> None:
    cols, fmt = [ps.xyz], ["%.4f"] * 3
    if ps.rgb is not None:
        cols.append(ps.rgb.astype(np.float64))
        fmt += ["%d"] * 3
    np.savetxt(path, np.hstack(cols), fmt=fmt, delimiter=" ", newline="\n")
