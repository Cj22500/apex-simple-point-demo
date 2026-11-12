"""AutoCAD DXF export/import via ezdxf. Spec: docs/specs/sima-dxf.md

Plan drawings: x = easting, y = northing, z = height (CAD convention), full plane coordinates,
$INSUNITS = 6 (metres). Profile drawings: x = station, y = elevation (true scale by default).
"""
from __future__ import annotations

import io

import ezdxf
import numpy as np
from ezdxf import units

LAYERS = {
    "SURVEY_POINTS": 1,  # red
    "MEASUREMENTS": 4,  # cyan
    "SECTION_PLAN": 6,  # magenta
    "PROFILE": 3,  # green
    "PROFILE_GRID": 8,  # grey
    "VOLUME_BOUNDARY": 2,  # yellow
    "DESIGN_SURFACE": 5,  # blue
}


def _new_doc():
    doc = ezdxf.new("R2018", setup=True)
    doc.units = units.M
    doc.header["$INSUNITS"] = 6
    for name, color in LAYERS.items():
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    return doc


def _bytes(doc) -> bytes:
    s = io.StringIO()
    doc.write(s)
    return s.getvalue().encode("utf-8")


def plan_dxf(points: list[dict] | None = None, lines: list[dict] | None = None, polylines: list[dict] | None = None,
             sections: list[dict] | None = None, boundaries: list[dict] | None = None, text_height: float = 0.4) -> bytes:
    """points: {name, E, N, H}; lines: {label, a: [E,N,H], b}; polylines: {label, points}; sections: {a, b};
    boundaries: {label, points: [[E, N], ...]} (closed)."""
    doc = _new_doc()
    msp = doc.modelspace()
    for p in points or []:
        msp.add_point((p["E"], p["N"], p.get("H") or 0.0), dxfattribs={"layer": "SURVEY_POINTS"})
        msp.add_text(p["name"], height=text_height, dxfattribs={"layer": "SURVEY_POINTS"}).set_placement((p["E"] + 0.3, p["N"] + 0.3))
    for ln in lines or []:
        a, b = ln["a"], ln["b"]
        msp.add_line(tuple(a), tuple(b), dxfattribs={"layer": "MEASUREMENTS"})
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if ln.get("label"):
            msp.add_text(ln["label"], height=text_height, dxfattribs={"layer": "MEASUREMENTS"}).set_placement(mid)
    for pl in polylines or []:
        msp.add_polyline3d([tuple(p) for p in pl["points"]], dxfattribs={"layer": "MEASUREMENTS"})
    for s in sections or []:
        msp.add_line((s["a"][0], s["a"][1], 0), (s["b"][0], s["b"][1], 0), dxfattribs={"layer": "SECTION_PLAN"})
    for bd in boundaries or []:
        msp.add_lwpolyline([(p[0], p[1]) for p in bd["points"]], close=True, dxfattribs={"layer": "VOLUME_BOUNDARY"})
    return _bytes(doc)


def profile_dxf(station: np.ndarray, z: np.ndarray, title: str = "", vertical_exaggeration: float = 1.0,
                grid_station: float = 5.0, grid_z: float = 1.0, text_height: float = 0.3) -> bytes:
    """Ground line as an LWPOLYLINE in (station, elevation * VE) space with a labelled grid."""
    doc = _new_doc()
    msp = doc.modelspace()
    ve = vertical_exaggeration
    pts = [(float(s), float(h) * ve) for s, h in zip(station, z)]
    if pts:
        msp.add_lwpolyline(pts, dxfattribs={"layer": "PROFILE"})
        s0, s1 = 0.0, float(np.max(station))
        z0 = float(np.floor(np.min(z) / grid_z) * grid_z)
        z1 = float(np.ceil(np.max(z) / grid_z) * grid_z)
        for sv in np.arange(s0, s1 + 1e-9, grid_station):
            msp.add_line((sv, z0 * ve), (sv, z1 * ve), dxfattribs={"layer": "PROFILE_GRID"})
            msp.add_text(f"{sv:.0f}", height=text_height, dxfattribs={"layer": "PROFILE_GRID"}).set_placement((sv, z0 * ve - 2 * text_height))
        for zv in np.arange(z0, z1 + 1e-9, grid_z):
            msp.add_line((s0, zv * ve), (s1, zv * ve), dxfattribs={"layer": "PROFILE_GRID"})
            msp.add_text(f"{zv:.1f}", height=text_height, dxfattribs={"layer": "PROFILE_GRID"}).set_placement((s0 - 6 * text_height, zv * ve))
        if title:
            msp.add_text(title, height=text_height * 1.5, dxfattribs={"layer": "PROFILE"}).set_placement((s0, z1 * ve + 3 * text_height))
    return _bytes(doc)


def design_tin_dxf(verts: np.ndarray, tris: np.ndarray) -> bytes:
    doc = _new_doc()
    msp = doc.modelspace()
    for t in tris:
        a, b, c = (tuple(map(float, verts[i])) for i in t)
        msp.add_3dface([a, b, c, c], dxfattribs={"layer": "DESIGN_SURFACE"})
    return _bytes(doc)


def read_design_tin(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """3DFACE entities -> (vertices, triangles); quads are split into two triangles."""
    doc = ezdxf.read(io.StringIO(data.decode("utf-8", errors="replace")))
    verts: list[tuple[float, float, float]] = []
    index: dict[tuple[float, float, float], int] = {}
    tris: list[list[int]] = []

    def vid(p) -> int:
        key = (round(p[0], 6), round(p[1], 6), round(p[2], 6))
        if key not in index:
            index[key] = len(verts)
            verts.append((float(p[0]), float(p[1]), float(p[2])))
        return index[key]

    for f in doc.modelspace().query("3DFACE"):
        vs = [vid(v) for v in f.wcs_vertices()]
        if len(vs) == 3 or vs[2] == vs[3]:  # ezdxf drops the duplicated 4th vertex of triangles
            tris.append(vs[:3])
        else:
            tris += [[vs[0], vs[1], vs[2]], [vs[0], vs[2], vs[3]]]
    if not tris:
        raise ValueError("no 3DFACE entities found")
    return np.array(verts), np.array(tris)
