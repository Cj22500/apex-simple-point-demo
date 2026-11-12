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


def build_case() -> None:
    """Deterministic octree build (shuffle=False) for the TypeScript port parity test."""
    import tempfile

    from app.core.octree import OctreeConfig, build_octree

    rng = np.random.default_rng(7)
    n = 6000
    xyz = np.column_stack([-4300 + rng.uniform(0, 60, n), -39000 + rng.uniform(0, 40, n), rng.uniform(0, 4, n)])
    xyz[:500] = xyz[:500] * 0 + np.array([-4280.0, -38990.0, 1.0]) + rng.normal(0, 0.3, (500, 3))  # dense cluster
    ps = PointSet(xyz=np.round(xyz, 4))
    cfg = OctreeConfig(grid=16, max_leaf=400, max_depth=8, shuffle=False)
    with tempfile.TemporaryDirectory() as d:
        h = build_octree(ps, pathlib.Path(d), cfg)
        from app.core.octree import decode_node

        nodes = []
        for nd in h["nodes"]:
            buf = (pathlib.Path(d) / "nodes" / f"{nd['name']}.bin").read_bytes()
            idx = decode_node(buf, nd["count"], nd["center"], [])["index"]
            nodes.append({"name": nd["name"], "level": nd["level"], "count": nd["count"], "index": idx.tolist(),
                          "center": nd["center"], "spacing": nd["spacing"], "children": nd["children"]})
    out = REPO / "shared" / "golden" / "octree_build.json"
    out.write_text(json.dumps({"config": {"grid": 16, "maxLeaf": 400, "maxDepth": 8}, "xyz": ps.xyz.tolist(),
                               "cube": h["cube"], "nodes": nodes}), encoding="utf-8")
    print("wrote", out, len(nodes), "nodes")




def las_case() -> None:
    """Small LAS + LAZ written by laspy (scale 0.0001, format 7 with RGB) for the browser reader test."""
    from app.core import pcio

    rng = np.random.default_rng(11)
    n = 1500
    ps = PointSet(
        xyz=np.round(np.column_stack([-4300 + rng.uniform(0, 80, n), -39000 + rng.uniform(0, 60, n), rng.uniform(0, 9, n)]), 4),
        intensity=rng.integers(0, 65535, n, dtype=np.uint16),
        rgb=rng.integers(0, 255, (n, 3), dtype=np.uint8),
        classification=rng.choice([1, 2, 6], n).astype(np.uint8),
    )
    out = REPO / "shared" / "golden"
    pcio.write_points(ps, out / "small.las")
    pcio.write_points(ps, out / "small.laz")
    (out / "small_las.json").write_text(json.dumps({"xyz": ps.xyz.tolist(), "intensity": ps.intensity.tolist(),
                                                    "rgb": ps.rgb.tolist(), "classification": ps.classification.tolist()}), encoding="utf-8")
    print("wrote small.las / small.laz")


if __name__ == "__main__":
    main()
    build_case()
    las_case()
