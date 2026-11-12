"""Point cloud -> 3D Gaussian Splatting PLY (the INRIA 3DGS attribute layout).

This is not a trained splat: each point becomes an isotropic Gaussian sized from the local point
spacing, with SH degree-0 colour from RGB. It shows the format and renders the cloud as a smooth
surface in any 3DGS viewer. Attributes (all float32, little endian):
    x y z · nx ny nz · f_dc_0..2 · opacity · scale_0..2 · rot_0..3
- f_dc = (rgb / 255 - 0.5) / C0 with C0 = 0.28209479177387814 (SH band 0 constant)
- opacity is stored as a logit, scale as log(sigma), rotation as a unit quaternion (w, x, y, z)
Positions are written relative to `origin` (float32 safety, same RTC origin as the viewer).
"""
from __future__ import annotations

import io

import numpy as np
from plyfile import PlyData, PlyElement
from scipy.spatial import cKDTree

SH_C0 = 0.28209479177387814
FIELDS = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
          "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]


def pointcloud_to_splat_ply(xyz: np.ndarray, rgb: np.ndarray | None, origin=(0.0, 0.0, 0.0), max_points: int = 400_000,
                            opacity: float = 0.95, seed: int = 0) -> bytes:
    xyz = np.asarray(xyz, dtype=np.float64)
    n = len(xyz)
    if n > max_points:
        idx = np.sort(np.random.default_rng(seed).choice(n, max_points, replace=False))
        xyz = xyz[idx]
        rgb = None if rgb is None else np.asarray(rgb)[idx]
    rel = xyz - np.asarray(origin, dtype=np.float64)
    # Gaussian sigma ~ 0.6 x distance to the 4th neighbour: overlapping, but not blurry
    d, _ = cKDTree(rel).query(rel, k=5, workers=-1)
    sigma = np.clip(0.6 * d[:, 4], 0.005, 0.5)
    colors = (np.full((len(rel), 3), 180, np.uint8) if rgb is None else np.asarray(rgb, np.uint8)).astype(np.float64) / 255.0
    arr = np.zeros(len(rel), dtype=[(f, "<f4") for f in FIELDS])
    arr["x"], arr["y"], arr["z"] = rel.T
    arr["f_dc_0"], arr["f_dc_1"], arr["f_dc_2"] = ((colors - 0.5) / SH_C0).T
    arr["opacity"] = np.log(opacity / (1 - opacity))
    for i in range(3):
        arr[f"scale_{i}"] = np.log(sigma)
    arr["rot_0"] = 1.0
    buf = io.BytesIO()
    PlyData([PlyElement.describe(arr, "vertex")], byte_order="<").write(buf)
    return buf.getvalue()


def splat_colors(ply: bytes) -> np.ndarray:
    """Decode RGB (0..255) from a splat PLY (for tests)."""
    v = PlyData.read(io.BytesIO(ply))["vertex"].data
    dc = np.column_stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]]).astype(np.float64)
    return np.clip((dc * SH_C0 + 0.5) * 255.0, 0, 255)
