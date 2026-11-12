"""Cut/fill earthwork volumes against a horizontal reference plane. Spec: docs/specs/earthwork-volume.md

cut  = volume of material ABOVE the reference plane (to remove)
fill = volume of space BELOW the reference plane (to fill)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.interpolate import griddata
from scipy.spatial import Delaunay


def points_in_polygon(xy: np.ndarray, poly: np.ndarray) -> np.ndarray:
    """Vectorised even-odd ray casting. poly: (m, 2), not closed."""
    x, y = xy[:, 0], xy[:, 1]
    inside = np.zeros(len(xy), bool)
    px, py = poly[:, 0], poly[:, 1]
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi, xj, yj = px[i], py[i], px[j], py[j]
        cond = (yi > y) != (yj > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xcross = (xj - xi) * (y - yi) / (yj - yi) + xi
        inside ^= cond & (x < xcross)
        j = i
    return inside


def polygon_area(poly: np.ndarray) -> float:
    p = poly - poly[0]
    x, y = p[:, 0], p[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y)) / 2)


@dataclass
class VolumeReport:
    method: str
    reference: float
    cut: float
    fill: float
    area: float
    cells_or_triangles: int
    extra: dict

    def to_dict(self) -> dict:
        return {"method": self.method, "reference_m": self.reference, "cut_m3": self.cut, "fill_m3": self.fill,
                "net_m3": self.cut - self.fill, "area_m2": self.area, "elements": self.cells_or_triangles, **self.extra}


# ------------------------------------------------------------------ TIN (exact for planar facets)
def tin_prism_volumes(tri_xy: np.ndarray, h: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Exact integrals of max(h, 0) and max(-h, 0) over triangles where h is linear.

    tri_xy: (t, 3, 2) plan coordinates; h: (t, 3) height above the reference plane.
    For a triangle with exactly one vertex above (h1 > 0 >= h2, h3), the positive part is
    A h1^3 / (3 (h1 - h2)(h1 - h3)); the rest follows from integral(h) = A (h1 + h2 + h3) / 3.
    """
    v1 = tri_xy[:, 1] - tri_xy[:, 0]
    v2 = tri_xy[:, 2] - tri_xy[:, 0]
    area = np.abs(v1[:, 0] * v2[:, 1] - v1[:, 1] * v2[:, 0]) / 2
    total = area * h.sum(1) / 3
    hs = np.sort(h, axis=1)  # ascending: hs[:,0] <= hs[:,1] <= hs[:,2]
    pos_count = (h > 0).sum(1)
    pos = np.zeros(len(h))
    neg = np.zeros(len(h))

    allp = pos_count == 3
    pos[allp] = total[allp]
    alln = pos_count == 0
    neg[alln] = -total[alln]

    one = pos_count == 1  # only the max vertex is above
    if one.any():
        a, b, c = hs[one, 2], hs[one, 1], hs[one, 0]
        pos[one] = area[one] * a**3 / (3 * (a - b) * (a - c))
        neg[one] = pos[one] - total[one]
    two = pos_count == 2  # only the min vertex is below (or on) the plane
    if two.any():
        g, b, c = -hs[two, 0], hs[two, 1], hs[two, 2]  # g = depth of the low vertex (>= 0)
        with np.errstate(divide="ignore", invalid="ignore"):
            n_part = np.where(g > 0, area[two] * g**3 / (3 * (g + b) * (g + c)), 0.0)
        neg[two] = n_part
        pos[two] = total[two] + n_part
    return pos, neg


def volume_tin(xyz: np.ndarray, polygon: np.ndarray | None, reference: float) -> VolumeReport:
    xyz = np.asarray(xyz, dtype=np.float64)
    origin = xyz[:, :2].min(axis=0)
    xy = xyz[:, :2] - origin
    poly = None if polygon is None else np.asarray(polygon, dtype=np.float64)[:, :2] - origin
    if poly is not None:
        sel = points_in_polygon(xy, poly)
        xy, z = xy[sel], xyz[sel, 2]
    else:
        z = xyz[:, 2]
    if len(xy) < 3:
        raise ValueError("fewer than 3 points inside the polygon")
    tri = Delaunay(xy)
    simp = tri.simplices
    tri_xy = xy[simp]
    pos, neg = tin_prism_volumes(tri_xy, z[simp] - reference)
    v1 = tri_xy[:, 1] - tri_xy[:, 0]
    v2 = tri_xy[:, 2] - tri_xy[:, 0]
    tri_area = float((np.abs(v1[:, 0] * v2[:, 1] - v1[:, 1] * v2[:, 0]) / 2).sum())
    return VolumeReport("tin", reference, float(pos.sum()), float(neg.sum()), tri_area, len(simp),
                        {"points_used": int(len(xy))})


# ------------------------------------------------------------------ grid DEM
@dataclass
class Dem:
    origin: np.ndarray  # lower-left corner (E, N) of cell (0, 0)
    cell: float
    z: np.ndarray  # (rows, cols), NaN outside / no data; row 0 = southern-most row
    inside: np.ndarray  # (rows, cols) bool, cell centre inside the polygon


def build_dem(xyz: np.ndarray, cell: float, polygon: np.ndarray | None = None, agg: str = "median",
              fill_gaps: bool = True) -> Dem:
    xyz = np.asarray(xyz, dtype=np.float64)
    poly = None if polygon is None else np.asarray(polygon, dtype=np.float64)[:, :2]
    lo = (poly.min(axis=0) if poly is not None else xyz[:, :2].min(axis=0))
    hi = (poly.max(axis=0) if poly is not None else xyz[:, :2].max(axis=0))
    lo = np.floor(lo / cell) * cell
    cols = int(np.ceil((hi[0] - lo[0]) / cell)) + 1
    rows = int(np.ceil((hi[1] - lo[1]) / cell)) + 1
    ij = np.floor((xyz[:, :2] - lo) / cell).astype(np.int64)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < cols) & (ij[:, 1] >= 0) & (ij[:, 1] < rows)
    flat = ij[ok, 1] * cols + ij[ok, 0]
    zz = xyz[ok, 2]
    grid = np.full(rows * cols, np.nan)
    if agg == "mean":
        s = np.bincount(flat, weights=zz, minlength=rows * cols)
        c = np.bincount(flat, minlength=rows * cols)
        with np.errstate(invalid="ignore", divide="ignore"):
            grid = np.where(c > 0, s / c, np.nan)
    else:  # median (robust to stray points)
        order = np.lexsort((zz, flat))
        f, zs = flat[order], zz[order]
        uniq, start, counts = np.unique(f, return_index=True, return_counts=True)
        mid = start + (counts - 1) // 2
        mid2 = start + counts // 2
        grid[uniq] = (zs[mid] + zs[mid2]) / 2
    grid = grid.reshape(rows, cols)
    cx = lo[0] + (np.arange(cols) + 0.5) * cell
    cy = lo[1] + (np.arange(rows) + 0.5) * cell
    gx, gy = np.meshgrid(cx, cy)
    centres = np.column_stack([gx.ravel(), gy.ravel()])
    inside = (points_in_polygon(centres, poly) if poly is not None else np.ones(len(centres), bool)).reshape(rows, cols)
    if fill_gaps:
        need = inside & np.isnan(grid)
        have = ~np.isnan(grid)
        if need.any() and have.sum() >= 3:
            grid[need] = griddata(np.column_stack([gx[have], gy[have]]), grid[have], (gx[need], gy[need]), method="linear")
            still = need & np.isnan(grid)
            if still.any():
                grid[still] = griddata(np.column_stack([gx[have], gy[have]]), grid[have], (gx[still], gy[still]), method="nearest")
    grid[~inside] = np.nan
    return Dem(lo, cell, grid, inside)


def volume_grid(xyz: np.ndarray, polygon: np.ndarray | None, reference: float, cell: float = 0.25, agg: str = "median") -> VolumeReport:
    dem = build_dem(xyz, cell, polygon, agg)
    h = dem.z[dem.inside] - reference
    h = h[np.isfinite(h)]
    a = cell * cell
    return VolumeReport("grid", reference, float(np.clip(h, 0, None).sum() * a), float(np.clip(-h, 0, None).sum() * a),
                        float(dem.inside.sum() * a), int(dem.inside.sum()), {"cell_m": cell, "aggregation": agg})


def write_geotiff(dem: Dem, path, epsg: int = 6677) -> None:
    """Write the DEM as a GeoTIFF (float32, NaN nodata). Raster row 0 = north, so flip rows.
    GeoTIFF/rasterio uses (x = easting, y = northing) for EPSG:6677 regardless of the EPSG axis order."""
    import rasterio
    from rasterio.transform import from_origin

    rows, cols = dem.z.shape
    top = dem.origin[1] + rows * dem.cell
    transform = from_origin(dem.origin[0], top, dem.cell, dem.cell)
    with rasterio.open(path, "w", driver="GTiff", height=rows, width=cols, count=1, dtype="float32",
                       crs=f"EPSG:{epsg}", transform=transform, nodata=np.nan, compress="deflate") as ds:
        ds.write(np.flipud(dem.z).astype(np.float32), 1)
