"""Deterministic synthetic construction-site LiDAR scan with analytically known ground truth.

Placed near Toyosu, Koto-ku, Tokyo, in JGD2011 Zone IX (EPSG:6677). Local frame: x east, y north
(metres) from the site origin SITE_E0 / SITE_N0; absolute E = SITE_E0 + x, N = SITE_N0 + y.
Heights are orthometric (JPGEO2024).

Features (all exact, see SITE_TRUTH):
- graded pad at 3.000 m with 1:1.5 side slopes to natural ground
- excavation pit, top 20 x 10 m, depth 3 m, 1:0.5 walls (法面) -> prismoidal volume 474 m^3,
  with a known over-dig defect (Gaussian, -0.20 m) in the floor for the as-built demo
- gravel stockpile: frustum R 8 m, r 2 m, h 4 m (epoch B: top removed down to h = 2 m)
- access ramp at exactly 5.000 % grade onto a platform at 5.500 m
- building (roof 15.000 m) and a retaining wall: vertical faces for sections
- epoch B: Gaussian settlement bowl, max -45 mm
- 3 mm Gaussian noise and 0.5 % outliers (indices known)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from app.core.pointset import PointSet

SITE_E0 = -4300.0  # JGD2011 Zone IX plane Y (east) of the local origin, m
SITE_N0 = -39000.0  # JGD2011 Zone IX plane X (north) of the local origin, m
EXTENT = (200.0, 140.0)

PAD = (10.0, 120.0, 10.0, 85.0)  # xmin, xmax, ymin, ymax
PAD_Z = 3.0
PIT_TOP = (30.0, 50.0, 30.0, 40.0)
PIT_DEPTH = 3.0
PIT_SLOPE_H_PER_V = 0.5  # 1:0.5 walls
DEFECT = {"x": 40.0, "y": 35.0, "amplitude": -0.20, "sigma": 0.8}
STOCKPILE = {"x": 85.0, "y": 60.0, "R": 8.0, "r": 2.0, "h": 4.0}
STOCKPILE_B_H = 2.0
RAMP = {"x0": 120.0, "x1": 170.0, "y0": 40.0, "y1": 50.0, "grade": 0.05}
PLATFORM = (170.0, 195.0, 30.0, 60.0)
PLATFORM_Z = PAD_Z + RAMP["grade"] * (RAMP["x1"] - RAMP["x0"])  # 5.5
EMBANK_H_PER_V = 1.5
BUILDING = (140.0, 170.0, 95.0, 125.0)
BUILDING_ROOF_Z = 15.0
WALL = {"x0": 10.0, "x1": 120.0, "y": 92.0, "top": 4.5}
BOWL = {"x": 100.0, "y": 30.0, "amplitude": -0.045, "sigma": 6.0}
SCANNER = (100.0, 70.0, 4.5)
NOISE_SIGMA = 0.003
OUTLIER_FRACTION = 0.005

CONTROL_POINTS = [  # (number, name, local x, local y)
    (1, "基準点1", 15.0, 15.0),
    (2, "基準点2", 118.0, 12.0),
    (3, "基準点3", 115.0, 80.0),
    (4, "基準点4", 15.0, 80.0),
    (5, "基準点5", 180.0, 45.0),
    (6, "基準点6", 60.0, 130.0),
]

# ASPRS classes
CLS_UNCLASSIFIED, CLS_GROUND, CLS_BUILDING = 1, 2, 6


# ------------------------------------------------------------------ analytic surfaces
def _rect_outside_distance(x, y, rect):
    x0, x1, y0, y1 = rect
    dx = np.maximum(np.maximum(x0 - x, x - x1), 0.0)
    dy = np.maximum(np.maximum(y0 - y, y - y1), 0.0)
    return np.hypot(dx, dy)


def _rect_inside_distance(x, y, rect):
    x0, x1, y0, y1 = rect
    return np.minimum(np.minimum(x - x0, x1 - x), np.minimum(y - y0, y1 - y))


def natural_ground(x, y):
    return (
        2.6
        + 0.35 * np.sin(2 * np.pi * x / 70.0)
        + 0.25 * np.cos(2 * np.pi * y / 55.0)
        + 0.15 * np.sin(2 * np.pi * (x + 2 * y) / 40.0)
    )


def pit_depth(x, y):
    """Depth below the pad of the 1:0.5 pit (0 outside the top rectangle)."""
    d = _rect_inside_distance(x, y, PIT_TOP)
    return np.where(d > 0, np.minimum(PIT_DEPTH, d / PIT_SLOPE_H_PER_V), 0.0)


def defect(x, y):
    r2 = (x - DEFECT["x"]) ** 2 + (y - DEFECT["y"]) ** 2
    return DEFECT["amplitude"] * np.exp(-r2 / (2 * DEFECT["sigma"] ** 2))


def stockpile_height(x, y, h=STOCKPILE["h"]):
    rho = np.hypot(x - STOCKPILE["x"], y - STOCKPILE["y"])
    slope = (STOCKPILE["R"] - STOCKPILE["r"]) / STOCKPILE["h"]  # horizontal per vertical
    return np.clip((STOCKPILE["R"] - rho) / slope, 0.0, h)


def bowl(x, y):
    r2 = (x - BOWL["x"]) ** 2 + (y - BOWL["y"]) ** 2
    return BOWL["amplitude"] * np.exp(-r2 / (2 * BOWL["sigma"] ** 2))


def embankment(x, y):
    """Ramp + platform embankment top with 1:1.5 side slopes (-inf where irrelevant)."""
    ramp_rect = (RAMP["x0"], RAMP["x1"], RAMP["y0"], RAMP["y1"])
    ramp_top = PAD_Z + RAMP["grade"] * (np.clip(x, RAMP["x0"], RAMP["x1"]) - RAMP["x0"])
    ramp = ramp_top - _rect_outside_distance(x, y, ramp_rect) / EMBANK_H_PER_V
    plat = PLATFORM_Z - _rect_outside_distance(x, y, PLATFORM) / EMBANK_H_PER_V
    return np.maximum(ramp, plat)


def _pad_blend(x, y):
    """Pad at PAD_Z blended into natural ground with 1:1.5 cut/fill slopes."""
    t = natural_ground(x, y)
    d = _rect_outside_distance(x, y, PAD)
    return PAD_Z - np.clip(PAD_Z - t, -d / EMBANK_H_PER_V, d / EMBANK_H_PER_V)


def ground_z(x, y, epoch: str = "A"):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    z = np.maximum(_pad_blend(x, y), embankment(x, y))
    z = z - pit_depth(x, y) + defect(x, y)
    z = z + stockpile_height(x, y, STOCKPILE["h"] if epoch == "A" else STOCKPILE_B_H)
    if epoch == "B":
        z = z + bowl(x, y)
    return z


def design_z(x, y):
    """Design surface for the as-built check: pad + pit (no defect, no stockpile, no settlement)."""
    return PAD_Z - pit_depth(np.asarray(x, float), np.asarray(y, float))


# ------------------------------------------------------------------ truth
def _analytic() -> dict:
    x0, x1, y0, y1 = PIT_TOP
    L, W, h = x1 - x0, y1 - y0, PIT_DEPTH
    inset = PIT_SLOPE_H_PER_V * h
    a_top, a_bot = L * W, (L - 2 * inset) * (W - 2 * inset)
    a_mid = (L - inset) * (W - inset)
    pit = h / 6 * (a_top + 4 * a_mid + a_bot)
    defect_vol = -DEFECT["amplitude"] * 2 * math.pi * DEFECT["sigma"] ** 2
    R, r, hh = STOCKPILE["R"], STOCKPILE["r"], STOCKPILE["h"]
    pile_a = math.pi * hh / 3 * (R * R + R * r + r * r)
    rb = R - (R - r) / hh * STOCKPILE_B_H
    pile_b = math.pi * STOCKPILE_B_H / 3 * (R * R + R * rb + rb * rb)
    return {
        "pit_volume_design_m3": pit,
        "pit_defect_volume_m3": defect_vol,
        "pit_volume_epochA_m3": pit + defect_vol,
        "stockpile_volume_epochA_m3": pile_a,
        "stockpile_volume_epochB_m3": pile_b,
        "ramp_grade_percent": RAMP["grade"] * 100,
        "ramp_grade_degrees": math.degrees(math.atan(RAMP["grade"])),
        "settlement_max_m": BOWL["amplitude"],
    }


ANALYTIC = _analytic()


def control_points() -> list[dict]:
    out = []
    for num, name, x, y in CONTROL_POINTS:
        z = float(ground_z(np.array([x]), np.array([y]))[0])
        out.append(
            {
                "number": num,
                "name": name,
                "name_en": f"CP-{num}",
                "name_ja": name,
                "E": SITE_E0 + x,
                "N": SITE_N0 + y,
                "H": round(z, 4),
                "local": [x, y],
            }
        )
    return out


def site_truth() -> dict:
    return {
        "crs": "EPSG:6677 (JGD2011 / Japan Plane Rectangular CS IX) + JGD2011 vertical (JPGEO2024)",
        "crs_code": "EPSG:6677+EPSG:6695",
        "geoid_model": "JPGEO2024",
        "origin": {"E": SITE_E0, "N": SITE_N0},
        "extent_m": EXTENT,
        "pad": {"rect_local": PAD, "z": PAD_Z},
        "pit": {"top_local": PIT_TOP, "depth": PIT_DEPTH, "slope": "1:0.5", "defect": DEFECT},
        "stockpile": {**STOCKPILE, "epochB_h": STOCKPILE_B_H, "base_z": PAD_Z},
        "ramp": {**RAMP, "platform_z": PLATFORM_Z},
        "building": {"footprint_local": BUILDING, "roof_z": BUILDING_ROOF_Z},
        "settlement_bowl_epochB": BOWL,
        "noise_sigma_m": NOISE_SIGMA,
        "outlier_fraction": OUTLIER_FRACTION,
        "analytic": ANALYTIC,
        "control_points": control_points(),
    }


# ------------------------------------------------------------------ sampling
@dataclass
class SiteScan:
    points: PointSet
    ideal_z: np.ndarray  # noise-free surface height at each point's (x, y), m
    outlier: np.ndarray  # bool, injected outliers
    local_xy: np.ndarray  # (n, 2) local coordinates
    meta: dict = field(default_factory=dict)


def _jittered_grid(rng, x0, x1, y0, y1, spacing):
    xs = np.arange(x0, x1, spacing)
    ys = np.arange(y0, y1, spacing)
    gx, gy = np.meshgrid(xs, ys)
    gx = gx.ravel() + rng.uniform(0, spacing, gx.size)
    gy = gy.ravel() + rng.uniform(0, spacing, gy.size)
    keep = (gx < x1) & (gy < y1)
    return gx[keep], gy[keep]


def _texture(x, y, z, rng):
    n = (
        np.sin(3.1 * x + 1.7 * y) * np.sin(2.3 * y - 1.1 * x + 0.7 * z)
        + 0.5 * np.sin(7.9 * x - 5.3 * y + 1.3) * np.sin(6.1 * y + 4.4 * x)
        + 0.25 * np.sin(17.3 * x + 13.1 * y) * np.sin(15.7 * y - 11.9 * x + 2.1 * z)
    )
    return 0.5 + 0.28 * n + rng.normal(0, 0.05, np.shape(x))


def _material(x, y, epoch):
    """Material id per ground point: 0 natural, 1 pad, 2 pit, 3 stockpile, 4 ramp/platform."""
    mat = np.zeros(np.shape(x), np.int8)
    mat[_rect_outside_distance(x, y, PAD) == 0] = 1
    mat[embankment(x, y) > _pad_blend(x, y)] = 4
    mat[pit_depth(x, y) > 0] = 2
    h = STOCKPILE["h"] if epoch == "A" else STOCKPILE_B_H
    mat[stockpile_height(x, y, h) > 0] = 3
    return mat


_REFLECTANCE = np.array([0.22, 0.35, 0.30, 0.50, 0.14, 0.60, 0.40, 0.55])  # + 5 walls, 6 roof, 7 retaining wall
_COLOR = np.array(
    [[96, 118, 70], [150, 128, 98], [128, 100, 72], [168, 162, 150], [70, 70, 74], [205, 200, 190], [120, 120, 125], [185, 182, 175]],
    dtype=np.float64,
)


def generate_site(epoch: str = "A", density: float = 100.0, seed: int = 20261112) -> SiteScan:
    """Sample the site at `density` points per m^2 of surface (default ~3.1 M points)."""
    if epoch not in ("A", "B"):
        raise ValueError("epoch must be 'A' or 'B'")
    rng = np.random.default_rng(seed + (0 if epoch == "A" else 1))
    spacing = 1.0 / math.sqrt(density)

    # ground (excluding the building footprint)
    gx, gy = _jittered_grid(rng, 0.0, EXTENT[0], 0.0, EXTENT[1], spacing)
    inside_bldg = _rect_outside_distance(gx, gy, BUILDING) == 0
    gx, gy = gx[~inside_bldg], gy[~inside_bldg]
    gz = ground_z(gx, gy, epoch)
    gmat = _material(gx, gy, epoch)
    gcls = np.full(gx.size, CLS_GROUND, np.uint8)

    parts_x, parts_y, parts_z, parts_m, parts_c = [gx], [gy], [gz], [gmat], [gcls]

    # building roof
    bx0, bx1, by0, by1 = BUILDING
    rx, ry = _jittered_grid(rng, bx0, bx1, by0, by1, spacing)
    parts_x.append(rx); parts_y.append(ry); parts_z.append(np.full(rx.size, BUILDING_ROOF_Z))
    parts_m.append(np.full(rx.size, 6, np.int8)); parts_c.append(np.full(rx.size, CLS_BUILDING, np.uint8))

    # building walls (vertical faces): sample (along, height) then map to the wall line
    for (xa, ya, xb, yb) in ((bx0, by0, bx1, by0), (bx1, by0, bx1, by1), (bx1, by1, bx0, by1), (bx0, by1, bx0, by0)):
        length = math.hypot(xb - xa, yb - ya)
        s, hgt = _jittered_grid(rng, 0.0, length, 0.0, BUILDING_ROOF_Z, spacing)
        wx = xa + (xb - xa) * s / length
        wy = ya + (yb - ya) * s / length
        base = ground_z(wx, wy, epoch)
        keep = hgt > base
        parts_x.append(wx[keep]); parts_y.append(wy[keep]); parts_z.append(hgt[keep])
        parts_m.append(np.full(keep.sum(), 5, np.int8)); parts_c.append(np.full(keep.sum(), CLS_BUILDING, np.uint8))

    # retaining wall (vertical face, both sides sampled at the same plane)
    s, hgt = _jittered_grid(rng, WALL["x0"], WALL["x1"], 0.0, WALL["top"], spacing)
    wy = np.full(s.size, WALL["y"])
    base = ground_z(s, wy, epoch)
    keep = hgt > base
    parts_x.append(s[keep]); parts_y.append(wy[keep]); parts_z.append(hgt[keep])
    parts_m.append(np.full(keep.sum(), 7, np.int8)); parts_c.append(np.full(keep.sum(), CLS_UNCLASSIFIED, np.uint8))

    x = np.concatenate(parts_x)
    y = np.concatenate(parts_y)
    ideal = np.concatenate(parts_z)
    mat = np.concatenate(parts_m)
    cls = np.concatenate(parts_c)
    n = x.size

    noise = rng.normal(0.0, NOISE_SIGMA, (n, 3))
    xyz = np.column_stack([SITE_E0 + x + noise[:, 0], SITE_N0 + y + noise[:, 1], ideal + noise[:, 2]])

    outlier = np.zeros(n, bool)
    idx = rng.choice(n, int(round(n * OUTLIER_FRACTION)), replace=False)
    outlier[idx] = True
    above = rng.random(idx.size) < 0.7
    xyz[idx, 2] += np.where(above, rng.uniform(0.3, 6.0, idx.size), -rng.uniform(0.3, 2.0, idx.size))

    # intensity: material reflectance x range falloff from a virtual scanner station
    rng_m = np.sqrt((x - SCANNER[0]) ** 2 + (y - SCANNER[1]) ** 2 + (ideal - SCANNER[2]) ** 2)
    inten = _REFLECTANCE[mat] * (1.0 - 0.6 * np.clip(rng_m / 250.0, 0, 1)) + rng.normal(0, 0.015, n)
    intensity = np.clip(inten * 65535 * 1.4, 0, 65535).astype(np.uint16)

    tex = _texture(x, y, ideal, rng)[:, None]
    rgb = np.clip(_COLOR[mat] * (0.55 + 0.9 * tex), 0, 255).astype(np.uint8)

    ps = PointSet(xyz=xyz, intensity=intensity, rgb=rgb, classification=cls)
    return SiteScan(points=ps, ideal_z=ideal, outlier=outlier, local_xy=np.column_stack([x, y]),
                    meta={"epoch": epoch, "density": density, "seed": seed, "points": n})


DESIGN_APRON = 5.0  # m of flat pad around the pit included in the as-built evaluation area


def design_tin() -> tuple[np.ndarray, np.ndarray]:
    """Design TIN (absolute E, N, H vertices; triangles) for the excavation area: the pit plus a
    5 m flat apron, triangulated along breaklines. The stockpile area is deliberately outside: a
    material heap on the pad is not part of the finished excavation surface."""
    px0, px1, py0, py1 = (PIT_TOP[0] - DESIGN_APRON, PIT_TOP[1] + DESIGN_APRON, PIT_TOP[2] - DESIGN_APRON, PIT_TOP[3] + DESIGN_APRON)
    tx0, tx1, ty0, ty1 = PIT_TOP
    ins = PIT_SLOPE_H_PER_V * PIT_DEPTH
    fx0, fx1, fy0, fy1 = tx0 + ins, tx1 - ins, ty0 + ins, ty1 - ins
    zb = PAD_Z - PIT_DEPTH
    local = np.array([
        [px0, py0, PAD_Z], [px1, py0, PAD_Z], [px1, py1, PAD_Z], [px0, py1, PAD_Z],  # 0-3 pad corners
        [tx0, ty0, PAD_Z], [tx1, ty0, PAD_Z], [tx1, ty1, PAD_Z], [tx0, ty1, PAD_Z],  # 4-7 pit top
        [fx0, fy0, zb], [fx1, fy0, zb], [fx1, fy1, zb], [fx0, fy1, zb],  # 8-11 pit floor
    ])
    tris = np.array([
        # pad ring (flat, z = PAD_Z)
        [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
        # pit walls (1:0.5)
        [4, 5, 9], [4, 9, 8], [5, 6, 10], [5, 10, 9], [6, 7, 11], [6, 11, 10], [7, 4, 8], [7, 8, 11],
        # pit floor
        [8, 9, 10], [8, 10, 11],
    ])
    verts = local.copy()
    verts[:, 0] += SITE_E0
    verts[:, 1] += SITE_N0
    return verts, tris
