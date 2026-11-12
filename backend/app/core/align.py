"""Closed-form similarity alignment (Umeyama 1991).

Used to georeference an SfM reconstruction: given camera centres in the SfM model frame (src) and
their RTK positions in JGD2011 plane coordinates (dst), find s, R, t minimising
    sum || dst_i - (s R src_i + t) ||^2
Reference: S. Umeyama, "Least-squares estimation of transformation parameters between two point
patterns", IEEE TPAMI 13(4), 1991.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Similarity:
    scale: float
    rotation: np.ndarray  # (3, 3), det = +1
    translation: np.ndarray  # (3,)

    def apply(self, pts: np.ndarray) -> np.ndarray:
        return self.scale * (np.asarray(pts, dtype=np.float64) @ self.rotation.T) + self.translation


def umeyama(src: np.ndarray, dst: np.ndarray, with_scale: bool = True) -> Similarity:
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    if src.shape != dst.shape or src.ndim != 2 or src.shape[1] != 3 or src.shape[0] < 3:
        raise ValueError("need matching (n, 3) arrays with n >= 3")
    mu_s, mu_d = src.mean(axis=0), dst.mean(axis=0)
    xs, xd = src - mu_s, dst - mu_d
    n = src.shape[0]
    cov = xd.T @ xs / n
    U, D, Vt = np.linalg.svd(cov)
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1.0  # avoid reflection
    R = U @ S @ Vt
    var_s = (xs**2).sum() / n
    if var_s == 0:
        raise ValueError("source points are degenerate (all identical)")
    scale = float(np.trace(np.diag(D) @ S) / var_s) if with_scale else 1.0
    t = mu_d - scale * R @ mu_s
    return Similarity(scale, R, t)


def rms_residual(sim: Similarity, src: np.ndarray, dst: np.ndarray) -> float:
    r = sim.apply(src) - np.asarray(dst, dtype=np.float64)
    return float(np.sqrt((r**2).sum(axis=1).mean()))
