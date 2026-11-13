"""3DGS PLY export edge cases: empty cloud, invalid max_points, small clouds (1 <= n < 5)."""
import io

import numpy as np
import pytest
from plyfile import PlyData

from app.core import splat


def test_splat_rejects_empty_cloud():
    with pytest.raises(ValueError, match="empty"):
        splat.pointcloud_to_splat_ply(np.empty((0, 3)), None)


@pytest.mark.parametrize("bad_max", [0, -1, -10])
def test_splat_rejects_nonpositive_max_points(bad_max):
    xyz = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
    with pytest.raises(ValueError, match="max_points"):
        splat.pointcloud_to_splat_ply(xyz, None, max_points=bad_max)


@pytest.mark.parametrize("n", [1, 2, 3, 4])
def test_splat_handles_fewer_than_five_points(n):
    xyz = np.column_stack([np.arange(n, dtype=np.float64), np.zeros(n), np.zeros(n)])
    rgb = np.full((n, 3), 128, dtype=np.uint8)
    data = splat.pointcloud_to_splat_ply(xyz, rgb)
    v = PlyData.read(io.BytesIO(data))["vertex"].data
    assert len(v) == n
    assert np.all(np.isfinite(v["scale_0"]))
    if n == 1:
        assert np.exp(v["scale_0"][0]) == pytest.approx(0.05, rel=1e-6)
