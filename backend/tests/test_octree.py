"""Octree: completeness, precision at Tokyo scale, LOD density invariant."""
import json

import numpy as np
import pytest

from app.core.octree import OctreeConfig, build_octree, decode_node
from app.core.pointset import PointSet
from app.synthetic import site


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    scan = site.generate_site("A", density=6)
    ps = scan.points
    ps.extra["dz"] = (scan.ideal_z * 0.01).astype(np.float32)  # exercise the extras path
    out = tmp_path_factory.mktemp("octree")
    h = build_octree(ps, out, OctreeConfig(grid=64, max_leaf=5_000))
    return ps, out, h


def _load(out, h, node):
    buf = (out / "nodes" / f"{node['name']}.bin").read_bytes()
    return buf, decode_node(buf, node["count"], node["center"], h["attributes"]["extras"])


def test_every_point_exactly_once(built):
    ps, out, h = built
    idx = np.concatenate([_load(out, h, nd)[1]["index"] for nd in h["nodes"]])
    assert idx.size == len(ps)
    assert np.array_equal(np.sort(idx), np.arange(len(ps)))
    assert sum(nd["count"] for nd in h["nodes"]) == h["points"]


def test_decoded_coordinates_precision(built, metric):
    ps, out, h = built
    worst = 0.0
    for nd in h["nodes"]:
        _, d = _load(out, h, nd)
        worst = max(worst, float(np.max(np.abs(d["xyz"] - ps.xyz[d["index"]]))))
        assert np.allclose(d["dz"], ps.extra["dz"][d["index"]])
        assert np.array_equal(d["intensity"], ps.intensity[d["index"]])
        assert np.array_equal(d["rgb"], ps.rgb[d["index"]])
    metric("Octree", f"decoded float64(center)+float32(offset) vs source, {len(ps):,} pts", worst * 1000, 0.05)
    assert worst <= 5e-5


def test_points_inside_their_node(built):
    ps, out, h = built
    for nd in h["nodes"]:
        _, d = _load(out, h, nd)
        assert np.all(d["xyz"] >= np.array(nd["min"]) - 1e-4) and np.all(d["xyz"] <= np.array(nd["max"]) + 1e-4)


def test_inner_nodes_hold_one_point_per_grid_cell(built):
    ps, out, h = built
    for nd in [n for n in h["nodes"] if not n["leaf"]][:20]:
        _, d = _load(out, h, nd)
        cell = np.floor((d["xyz"] - np.array(nd["min"])) / nd["spacing"]).astype(np.int64)
        assert len(np.unique(cell, axis=0)) == nd["count"], nd["name"]


def test_hierarchy_children_and_sizes(built):
    _, out, h = built
    names = {nd["name"] for nd in h["nodes"]}
    for nd in h["nodes"]:
        if nd["name"] != "r":
            assert nd["name"][:-1] in names  # parent exists
        for c in nd["children"]:
            assert f"{nd['name']}{c}" in names
        size = (out / "nodes" / f"{nd['name']}.bin").stat().st_size
        assert size == nd["count"] * (22 + 4 * len(h["attributes"]["extras"]))
    assert json.loads((out / "hierarchy.json").read_text())["format"] == "spl-octree-1"


def test_rejects_empty(tmp_path):
    out = tmp_path / "unused"
    with pytest.raises(ValueError, match="empty point cloud"):
        build_octree(PointSet(np.empty((0, 3))), out)
    assert not out.exists()
