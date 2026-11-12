"""Point cloud processing: SOR cleaning, cross-section profile, change detection (M3C2-lite).

All functions are vectorised NumPy/SciPy and work on float64 [E, N, H] arrays.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree


# ------------------------------------------------------------------ SOR
@dataclass
class SorResult:
    keep: np.ndarray  # bool mask
    mean_dist: np.ndarray
    threshold: float

    def summary(self) -> dict:
        return {"kept": int(self.keep.sum()), "removed": int((~self.keep).sum()), "threshold_m": self.threshold}


def statistical_outlier_removal(xyz: np.ndarray, k: int = 16, n_sigma: float = 1.0, chunk: int = 500_000) -> SorResult:
    """Classic SOR (as in PCL/CloudCompare): a point is an outlier if its mean distance to its k
    nearest neighbours exceeds mean + n_sigma * std of that statistic over the whole cloud.

    Default n_sigma = 1.0 (not PCL's customary 2.0): on the synthetic site, 2.0 misses ~76 % of
    outliers lying within 0.5 m of the surface (recall 95.1 %), 1.0 finds 99.98 % with no good
    points removed. Densities vary more on real TLS data, so the value is exposed in the API."""
    xyz = np.asarray(xyz, dtype=np.float64)
    local = xyz - xyz.min(axis=0)  # kd-tree on small numbers
    tree = cKDTree(local)
    mean_dist = np.empty(len(xyz))
    for s in range(0, len(xyz), chunk):
        d, _ = tree.query(local[s : s + chunk], k=k + 1, workers=-1)
        mean_dist[s : s + chunk] = d[:, 1:].mean(axis=1)  # skip self
    thr = float(mean_dist.mean() + n_sigma * mean_dist.std())
    return SorResult(mean_dist <= thr, mean_dist, thr)


# ------------------------------------------------------------------ profile
@dataclass
class Profile:
    length: float
    station: np.ndarray  # along A->B, m
    offset: np.ndarray  # signed, + left of A->B
    z: np.ndarray
    index: np.ndarray  # indices into the source cloud
    ground_station: np.ndarray
    ground_z: np.ndarray


def extract_profile(xyz: np.ndarray, a, b, half_width: float, bin_size: float = 0.1,
                    ground_quantile: float = 0.1, cls: np.ndarray | None = None) -> Profile:
    """Points inside the corridor |offset| <= half_width, 0 <= station <= |AB| (plan), plus a
    ground line = per-bin lower quantile of z (robust to vegetation and outliers above ground)."""
    a = np.asarray(a, dtype=np.float64)[:2]
    b = np.asarray(b, dtype=np.float64)[:2]
    ab = b - a
    length = float(np.hypot(*ab))
    if length <= 0:
        raise ValueError("section line has zero length")
    u = ab / length
    n = np.array([-u[1], u[0]])
    lo = np.minimum(a, b) - half_width
    hi = np.maximum(a, b) + half_width
    cand = np.nonzero((xyz[:, 0] >= lo[0]) & (xyz[:, 0] <= hi[0]) & (xyz[:, 1] >= lo[1]) & (xyz[:, 1] <= hi[1]))[0]
    rel = xyz[cand, :2] - a
    s = rel @ u
    d = rel @ n
    m = (np.abs(d) <= half_width) & (s >= 0) & (s <= length)
    idx, s, d = cand[m], s[m], d[m]
    z = xyz[idx, 2]
    order = np.argsort(s, kind="stable")
    idx, s, d, z = idx[order], s[order], d[order], z[order]

    gmask = np.ones(len(idx), bool) if cls is None else (np.asarray(cls)[idx] == 2)
    gs, gz = s[gmask], z[gmask]
    if len(gs):
        bins = np.floor(gs / bin_size).astype(np.int64)
        uniq, start = np.unique(bins, return_index=True)
        ends = np.append(start[1:], len(bins))
        ground_s = (uniq + 0.5) * bin_size
        ground_z = np.array([np.quantile(gz[st:en], ground_quantile) for st, en in zip(start, ends)])
    else:
        ground_s = ground_z = np.empty(0)
    return Profile(length, s, d, z, idx, ground_s, ground_z)


# ------------------------------------------------------------------ change detection
@dataclass
class ChangeResult:
    dz: np.ndarray  # float32 per point of B (NaN where A has no support)
    stats: dict


def vertical_change(xyz_a: np.ndarray, xyz_b: np.ndarray, k: int = 12, max_radius: float = 1.0,
                    max_gradient: float = 3.0, chunk: int = 300_000) -> ChangeResult:
    """M3C2-lite vertical change: for each point of epoch B, fit a local plane z = c0 + c1 x + c2 y
    to its k nearest epoch-A neighbours (in plan), with one robust re-fit that drops residuals
    > 3 RMS (min 2 cm), and report dz = z_B - plane_A(x_B, y_B). The plane removes the bias that
    nearest-point differencing has on slopes (error = slope x horizontal offset)."""
    origin = np.minimum(xyz_a.min(axis=0), xyz_b.min(axis=0))
    A = xyz_a - origin
    B = xyz_b - origin
    tree = cKDTree(A[:, :2])
    dz = np.full(len(B), np.nan, dtype=np.float64)
    for s in range(0, len(B), chunk):
        pb = B[s : s + chunk]
        dist, nn = tree.query(pb[:, :2], k=k, workers=-1)
        valid = dist[:, -1] <= max_radius
        q = A[nn]  # (m, k, 3)
        dx = q[:, :, 0] - pb[:, None, 0]
        dy = q[:, :, 1] - pb[:, None, 1]
        zz = q[:, :, 2]
        # robust start: drop neighbours far from the median (MAD), so outliers can't bias the
        # first fit (an RMS-based first pass is itself inflated by the outlier and keeps it)
        med = np.median(zz, axis=1, keepdims=True)
        mad = 1.4826 * np.median(np.abs(zz - med), axis=1, keepdims=True)
        w = (np.abs(zz - med) <= np.maximum(3 * mad, 0.05)).astype(np.float64)
        for _ in range(2):
            c0 = _weighted_plane_at_origin(dx, dy, zz, w)
            res = zz - (c0[:, 0:1] + c0[:, 1:2] * dx + c0[:, 2:3] * dy)
            rms = np.sqrt((w * res**2).sum(1) / np.maximum(w.sum(1), 1))
            w = (np.abs(res) <= np.maximum(3 * rms, 0.02)[:, None]).astype(np.float64)
        dz_chunk = pb[:, 2] - c0[:, 0]  # plane evaluated at the B point (dx = dy = 0)
        # Vertical change is undefined on (near-)vertical faces: walls give ill-conditioned plane
        # fits and extrapolate to hundreds of metres. Gradient > 3 (~72°) -> unsupported (NaN).
        steep = np.hypot(c0[:, 1], c0[:, 2]) > max_gradient
        dz_chunk[~valid | steep] = np.nan
        dz[s : s + chunk] = dz_chunk
    ok = np.isfinite(dz)
    v = dz[ok]
    stats = {
        "points": int(len(dz)), "supported": int(ok.sum()),
        "min_m": float(v.min()) if len(v) else None, "max_m": float(v.max()) if len(v) else None,
        "mean_m": float(v.mean()) if len(v) else None, "rms_m": float(np.sqrt((v**2).mean())) if len(v) else None,
        "p01_m": float(np.percentile(v, 1)) if len(v) else None, "p99_m": float(np.percentile(v, 99)) if len(v) else None,
    }
    return ChangeResult(dz.astype(np.float32), stats)


def _weighted_plane_at_origin(dx, dy, zz, w):
    """Batch weighted least squares for z = c0 + c1 dx + c2 dy. Returns (m, 3)."""
    s1 = w.sum(1)
    sx, sy = (w * dx).sum(1), (w * dy).sum(1)
    sxx, syy, sxy = (w * dx * dx).sum(1), (w * dy * dy).sum(1), (w * dx * dy).sum(1)
    sz, sxz, syz = (w * zz).sum(1), (w * dx * zz).sum(1), (w * dy * zz).sum(1)
    M = np.stack([np.stack([s1, sx, sy], -1), np.stack([sx, sxx, sxy], -1), np.stack([sy, sxy, syy], -1)], -2)
    rhs = np.stack([sz, sxz, syz], -1)
    M = M + np.eye(3)[None] * 1e-9  # guard against collinear neighbourhoods
    return np.linalg.solve(M, rhs[..., None])[..., 0]
