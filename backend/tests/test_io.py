"""Format round-trips at Tokyo-scale coordinates: LAS, LAZ, E57, PLY, PTS, XYZ."""
import numpy as np
import pytest

from app.core import pcio
from app.core.pointset import PointSet


@pytest.fixture(scope="module")
def cloud():
    rng = np.random.default_rng(3)
    n = 5_000
    xyz = np.column_stack([
        -4300.0 + rng.uniform(0, 200, n),
        -39000.0 + rng.uniform(0, 140, n),
        rng.uniform(0, 15, n),
    ])
    xyz = np.round(xyz, 4)  # survey data has 0.1 mm resolution
    return PointSet(
        xyz=xyz,
        intensity=rng.integers(0, 65535, n, dtype=np.uint16),
        rgb=rng.integers(0, 255, (n, 3), dtype=np.uint8),
        classification=rng.choice([1, 2, 6], n).astype(np.uint8),
    )


@pytest.mark.parametrize("ext", [".las", ".laz", ".e57", ".ply", ".pts", ".xyz"])
def test_round_trip(cloud, tmp_path, ext, metric):
    path = pcio.write_points(cloud, tmp_path / f"cloud{ext}")
    back = pcio.read_points(path)
    assert len(back) == len(cloud)
    err = float(np.max(np.abs(back.xyz - cloud.xyz)))
    metric("File I/O", f"{ext.upper()[1:]} round trip at Tokyo-scale coordinates (max coord error)", err * 1000, 0.1)
    assert err <= 1e-4
    if ext != ".xyz":  # XYZ carries no intensity when RGB is present
        tol = 1 if ext in (".pts", ".e57") else 0  # PTS is 12-bit intensity, E57 normalised float
        if ext == ".pts":
            assert np.max(np.abs(back.intensity.astype(int) - cloud.intensity.astype(int))) <= 65535 / 4095
        else:
            assert np.max(np.abs(back.intensity.astype(int) - cloud.intensity.astype(int))) <= tol
    assert np.array_equal(back.rgb, cloud.rgb)
    if ext in (".las", ".laz", ".ply"):
        assert np.array_equal(back.classification, cloud.classification)


def test_las_quantisation_is_0_1_mm(cloud, tmp_path):
    import laspy

    pcio.write_points(cloud, tmp_path / "q.las")
    hdr = laspy.read(tmp_path / "q.las").header
    assert np.allclose(hdr.scales, 1e-4)


def test_detect_by_magic_bytes(cloud, tmp_path):
    p = pcio.write_points(cloud, tmp_path / "x.laz")
    renamed = p.rename(tmp_path / "x.bin")
    assert pcio.detect_format(renamed) == "las"


def test_unknown_format(tmp_path):
    f = tmp_path / "x.dat"
    f.write_bytes(b"\x00\x01garbage")
    with pytest.raises(pcio.UnsupportedFormat):
        pcio.read_points(f)


def test_xyz_comma_and_header_comments(tmp_path):
    f = tmp_path / "pts.csv"
    f.write_text("# E,N,H\n-4300.1234,-39000.5678,3.0001\n-4299.0000,-38999.0000,4.0000\n", encoding="utf-8")
    ps = pcio.read_points(f)
    assert ps.xyz.shape == (2, 3) and abs(ps.xyz[0, 0] + 4300.1234) < 1e-9
