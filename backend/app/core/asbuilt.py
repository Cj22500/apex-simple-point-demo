"""As-built surface inspection (出来形管理・面管理). Spec: docs/specs/asbuilt.md

Deviation = vertical difference (標高較差) between each scan point and the design TIN at the same
plan position. Triangles steeper than SLOPE_THRESHOLD are 法面 (slope), the rest 平場 (flat).
Points within ±5 cm (plan) of a crest/toe (法肩・法尻: edges shared by a flat and a slope
triangle) are excluded from the evaluation.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# MLIT excavation (掘削工, 面管理) tolerances in metres; see docs/specs/asbuilt.md for sources.
TOLERANCES = {
    "flat": {"mean": 0.050, "individual": 0.150},
    "slope": {"mean": 0.070, "individual": 0.160},
}
SLOPE_THRESHOLD = 0.10  # triangle grade above 10 % counts as 法面
EDGE_EXCLUSION = 0.05  # m
GRID = 1.0  # m, evaluation grid (1 m^2)
MIN_POINTS_PER_CELL = 1  # density: >= 1 point per evaluation cell (>= 1 pt/m^2)


@dataclass
class AsBuiltResult:
    dz: np.ndarray  # deviation per evaluated point (m)
    index: np.ndarray  # indices into the input cloud
    surface: np.ndarray  # 0 flat, 1 slope (per evaluated point)
    summary: dict
    cells: dict = field(default_factory=dict)


def _triangle_types(verts: np.ndarray, tris: np.ndarray) -> np.ndarray:
    p0, p1, p2 = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    n = np.cross(p1 - p0, p2 - p0)
    horiz = np.hypot(n[:, 0], n[:, 1])
    grade = horiz / np.maximum(np.abs(n[:, 2]), 1e-12)  # tan(slope angle)
    return (grade > SLOPE_THRESHOLD).astype(np.int8)


def _breaklines(tris: np.ndarray, types: np.ndarray) -> list[tuple[int, int]]:
    owner: dict[tuple[int, int], set[int]] = {}
    for t, tri in enumerate(tris):
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            owner.setdefault((min(a, b), max(a, b)), set()).add(int(types[t]))
    return [e for e, kinds in owner.items() if len(kinds) == 2]


def _dist_to_segments(xy: np.ndarray, segs: np.ndarray) -> np.ndarray:
    d = np.full(len(xy), np.inf)
    for a, b in segs:
        ab = b - a
        t = np.clip(((xy - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        proj = a + t[:, None] * ab
        d = np.minimum(d, np.hypot(*(xy - proj).T))
    return d


def inspect(xyz: np.ndarray, verts: np.ndarray, tris: np.ndarray, tolerances: dict = TOLERANCES) -> AsBuiltResult:
    xyz = np.asarray(xyz, dtype=np.float64)
    origin = verts[:, :2].min(axis=0)
    V = verts.astype(np.float64).copy()
    V[:, :2] -= origin
    P = xyz[:, :2] - origin
    types = _triangle_types(V, tris)

    dz = np.full(len(xyz), np.nan)
    surface = np.full(len(xyz), -1, np.int8)
    for t, (i0, i1, i2) in enumerate(tris):
        a, b, c = V[i0], V[i1], V[i2]
        lo = np.minimum(np.minimum(a[:2], b[:2]), c[:2])
        hi = np.maximum(np.maximum(a[:2], b[:2]), c[:2])
        cand = np.nonzero((P[:, 0] >= lo[0]) & (P[:, 0] <= hi[0]) & (P[:, 1] >= lo[1]) & (P[:, 1] <= hi[1]) & np.isnan(dz))[0]
        if not len(cand):
            continue
        v0, v1 = b[:2] - a[:2], c[:2] - a[:2]
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        w = P[cand] - a[:2]
        l1 = (w[:, 0] * v1[1] - v1[0] * w[:, 1]) / den
        l2 = (v0[0] * w[:, 1] - w[:, 0] * v0[1]) / den
        inside = (l1 >= -1e-9) & (l2 >= -1e-9) & (l1 + l2 <= 1 + 1e-9)
        sel = cand[inside]
        zd = a[2] + l1[inside] * (b[2] - a[2]) + l2[inside] * (c[2] - a[2])
        dz[sel] = xyz[sel, 2] - zd
        surface[sel] = types[t]

    in_design = ~np.isnan(dz)
    edges = _breaklines(tris, types)
    segs = np.array([[V[a, :2], V[b, :2]] for a, b in edges]) if edges else np.empty((0, 2, 2))
    near_edge = np.zeros(len(xyz), bool)
    if len(segs):
        idx = np.nonzero(in_design)[0]
        near_edge[idx] = _dist_to_segments(P[idx], segs) <= EDGE_EXCLUSION
    evaluated = in_design & ~near_edge
    index = np.nonzero(evaluated)[0]

    summary: dict = {"tolerances_m": tolerances, "edge_exclusion_m": EDGE_EXCLUSION, "excluded_near_breaklines": int((in_design & near_edge).sum())}
    verdict = True
    for code, name in ((0, "flat"), (1, "slope")):
        m = evaluated & (surface == code)
        v = dz[m]
        tol = tolerances[name]
        if len(v) == 0:
            summary[name] = {"points": 0}
            continue
        exceed = int((np.abs(v) > tol["individual"]).sum())
        mean_ok = abs(float(v.mean())) <= tol["mean"]
        ok = mean_ok and exceed == 0
        verdict &= ok
        summary[name] = {
            "points": int(len(v)), "mean_m": float(v.mean()), "std_m": float(v.std()),
            "min_m": float(v.min()), "max_m": float(v.max()),
            "exceeding_individual": exceed, "within_individual_pct": float(100 * (1 - exceed / len(v))),
            "mean_ok": mean_ok, "pass": ok,
        }

    # evaluation grid (1 m): density check + per-cell mean deviation for the heatmap
    design_area_xy = V[:, :2]
    gmin = np.floor(design_area_xy.min(axis=0) / GRID) * GRID
    gmax = design_area_xy.max(axis=0)
    cols = int(np.ceil((gmax[0] - gmin[0]) / GRID)) + 1
    rows = int(np.ceil((gmax[1] - gmin[1]) / GRID)) + 1
    centres = np.stack(np.meshgrid(gmin[0] + (np.arange(cols) + 0.5) * GRID, gmin[1] + (np.arange(rows) + 0.5) * GRID), -1).reshape(-1, 2)
    cell_in = _cells_inside_tin(centres, V, tris)
    ij = np.floor((P[index] - gmin) / GRID).astype(np.int64)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < cols) & (ij[:, 1] >= 0) & (ij[:, 1] < rows)
    flat_ids = ij[ok, 1] * cols + ij[ok, 0]
    counts = np.bincount(flat_ids, minlength=rows * cols)
    sums = np.bincount(flat_ids, weights=dz[index][ok], minlength=rows * cols)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean_cell = np.where(counts > 0, sums / counts, np.nan)
    empty = cell_in & (counts < MIN_POINTS_PER_CELL)
    density_ok = int(empty.sum()) == 0
    verdict &= density_ok
    summary["density"] = {"grid_m": GRID, "cells": int(cell_in.sum()), "cells_below_min": int(empty.sum()),
                          "min_points_per_cell": MIN_POINTS_PER_CELL, "pass": density_ok}
    summary["pass"] = bool(verdict)
    cells = {"origin": (gmin + origin).tolist(), "size": GRID, "cols": cols, "rows": rows,
             "mean_dz": [None if not (ci and np.isfinite(mc)) else round(float(mc), 5) for ci, mc in zip(cell_in, mean_cell)],
             "count": counts.tolist()}
    return AsBuiltResult(dz[index], index, surface[index], summary, cells)


def _cells_inside_tin(xy: np.ndarray, V: np.ndarray, tris: np.ndarray) -> np.ndarray:
    inside = np.zeros(len(xy), bool)
    for i0, i1, i2 in tris:
        a, b, c = V[i0, :2], V[i1, :2], V[i2, :2]
        v0, v1 = b - a, c - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        w = xy - a
        l1 = (w[:, 0] * v1[1] - v1[0] * w[:, 1]) / den
        l2 = (v0[0] * w[:, 1] - w[:, 0] * v0[1]) / den
        inside |= (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
    return inside
