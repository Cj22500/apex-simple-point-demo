"""Write a Python-encoded octree node + expected float64 coordinates for the TypeScript decoder test.

Usage: backend/.venv/Scripts/python scripts/make_golden_octree.py
"""
from __future__ import annotations

import json
import pathlib
import sys

import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.core.octree import encode_node  # noqa: E402
from app.core.pointset import PointSet  # noqa: E402


def main() -> None:
    rng = np.random.default_rng(99)
    n = 257
    center = np.array([-4250.0, -38930.0, 7.5])
    xyz = np.round(center + rng.uniform(-100, 100, (n, 3)), 4)
    ps = PointSet(
        xyz=xyz,
        intensity=rng.integers(0, 65535, n, dtype=np.uint16),
        rgb=rng.integers(0, 255, (n, 3), dtype=np.uint8),
        classification=rng.choice([1, 2, 6], n).astype(np.uint8),
        extra={"dz": rng.normal(0, 0.02, n).astype(np.float32)},
    )
    idx = np.arange(n)
    out = REPO / "shared" / "golden"
    (out / "octree_node.bin").write_bytes(encode_node(ps, idx, center, ["dz"]))
    (out / "octree_node.json").write_text(json.dumps({
        "count": n, "center": center.tolist(), "extras": ["dz"],
        "xyz": xyz.tolist(), "intensity": ps.intensity.tolist(), "rgb": ps.rgb.tolist(),
        "classification": ps.classification.tolist(), "dz": ps.extra["dz"].astype(float).tolist(),
    }), encoding="utf-8")
    print("wrote", out / "octree_node.bin")


if __name__ == "__main__":
    main()
