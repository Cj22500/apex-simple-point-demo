"""docs/specs/earthwork-volume.md acceptance criteria."""
import numpy as np
import pytest

from app.core.analysis import statistical_outlier_removal
from app.core.volume import build_dem, tin_prism_volumes, volume_grid, volume_tin, write_geotiff
from app.synthetic import site

E0, N0 = -5995.1852, -35367.2301  # Tokyo-scale offset for every test surface


def pyramid_points(base=10.0, height=6.0):
    h = base / 2
    return np.array([[E0 - h, N0 - h, 0], [E0 + h, N0 - h, 0], [E0 + h, N0 + h, 0], [E0 - h, N0 + h, 0], [E0, N0, height]])


def test_tin_exact_pyramid(golden_volumes, metric):
    r = volume_tin(pyramid_points(), None, reference=0.0)
    exp = golden_volumes["square_pyramid"]["volume"]
    rel = abs(r.cut - exp) / exp
    metric("Volume", "TIN: square pyramid 200 m³ (exact facets)", rel * 100, 1e-7, "%")
    assert rel <= 1e-9 and r.fill == pytest.approx(0, abs=1e-9)


def test_tin_exact_crossing_split(golden_volumes, metric):
    """Reference plane at half height: only the top similar pyramid (1/8) is above."""
    r = volume_tin(pyramid_points(), None, reference=3.0)
    exp = golden_volumes["half_cut_pyramid_ref_3m"]["cut_above_ref"]
    rel = abs(r.cut - exp) / exp
    metric("Volume", "TIN: crossing-plane split, pyramid above z = 3 m (25 m³)", rel * 100, 1e-7, "%")
    assert rel <= 1e-9
    # fill below the plane inside the base square: base area x 3 m minus the frustum part
    assert r.fill == pytest.approx(100 * 3 - (200 - 25), rel=1e-9)


def test_prism_formula_against_monte_carlo():
    rng = np.random.default_rng(5)
    tri = rng.uniform(0, 10, (200, 3, 2))
    h = rng.normal(0, 2, (200, 3))
    pos, neg = tin_prism_volumes(tri, h)
    # Monte Carlo integral of max(h,0) with barycentric sampling
    u = rng.random((200, 20000, 2))
    flip = u.sum(-1) > 1
    u[flip] = 1 - u[flip]
    hv = h[:, 0:1] * (1 - u[..., 0] - u[..., 1]) + h[:, 1:2] * u[..., 0] + h[:, 2:3] * u[..., 1]
    v1, v2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    area = np.abs(v1[:, 0] * v2[:, 1] - v1[:, 1] * v2[:, 0]) / 2
    mc_pos = area * np.clip(hv, 0, None).mean(1)
    mc_neg = area * np.clip(-hv, 0, None).mean(1)
    assert np.allclose(pos, mc_pos, rtol=0.03, atol=0.05)
    assert np.allclose(neg, mc_neg, rtol=0.03, atol=0.05)


def test_tin_pit_breakline_vertices_exact(metric):
    """TIN of the pit's 8 breakline vertices reproduces the prismoidal 474 m^3 exactly."""
    verts, _ = site.design_tin()
    r = volume_tin(verts[4:12], None, reference=site.PAD_Z)
    exp = site.ANALYTIC["pit_volume_design_m3"]
    rel = abs(r.fill - exp) / exp
    metric("Volume", "TIN: 1:0.5 pit from its breakline vertices (474 m³)", rel * 100, 1e-7, "%")
    assert rel <= 1e-9


def test_tin_pit_dense_grid_without_breaklines(metric):
    """FINDING: an unconstrained Delaunay of a regular grid chooses arbitrary cell diagonals, so
    triangles fold across the 45° hip lines. Small but non-zero error; production TINs should be
    constrained to breaklines."""
    xs = np.linspace(site.PIT_TOP[0], site.PIT_TOP[1], 81)
    ys = np.linspace(site.PIT_TOP[2], site.PIT_TOP[3], 41)
    gx, gy = np.meshgrid(xs, ys)
    z = site.design_z(gx.ravel(), gy.ravel())
    pts = np.column_stack([gx.ravel() + site.SITE_E0, gy.ravel() + site.SITE_N0, z])
    r = volume_tin(pts, None, reference=site.PAD_Z)
    exp = site.ANALYTIC["pit_volume_design_m3"]
    rel = abs(r.fill - exp) / exp
    metric("Volume", "TIN: pit on a 0.25 m grid, no breakline constraint", rel * 100, 0.05, "%")
    assert rel <= 5e-4


@pytest.fixture(scope="module")
def stockpile_scan():
    s = site.generate_site("A", density=100)
    sp = site.STOCKPILE
    local = s.local_xy
    near = np.hypot(local[:, 0] - sp["x"], local[:, 1] - sp["y"]) < sp["R"] + 4
    xyz = s.points.xyz[near]
    keep = statistical_outlier_removal(xyz).keep
    return xyz, keep


def _circle(cx, cy, r, n=128):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return np.column_stack([cx + r * np.cos(t), cy + r * np.sin(t)])


def test_grid_volume_stockpile_converges(stockpile_scan, metric):
    xyz, keep = stockpile_scan
    sp = site.STOCKPILE
    poly = _circle(site.SITE_E0 + sp["x"], site.SITE_N0 + sp["y"], sp["R"] + 2)
    exp = site.ANALYTIC["stockpile_volume_epochA_m3"]
    errs = {}
    for cell in (0.5, 0.25, 0.1):
        r = volume_grid(xyz[keep], poly, site.PAD_Z, cell=cell)
        errs[cell] = abs(r.cut - exp) / exp
        metric("Volume", f"grid {cell} m on cleaned scan (σ 3 mm): stockpile 351.858 m³", errs[cell] * 100, 0.5, "%")
    assert errs[0.25] <= 0.005 and errs[0.1] <= 0.005
    assert errs[0.5] >= errs[0.1]  # finer grid is not worse
    tin = volume_tin(xyz[keep], poly, site.PAD_Z)
    metric("Volume", "TIN on cleaned scan: stockpile 351.858 m³", abs(tin.cut - exp) / exp * 100, 0.5, "%")
    assert abs(tin.cut - exp) / exp <= 0.005


def test_raw_scan_outliers_bias_volume_until_cleaned(stockpile_scan, metric):
    """Why cleaning comes first: outliers above the pile inflate a mean-aggregated grid."""
    xyz, keep = stockpile_scan
    sp = site.STOCKPILE
    poly = _circle(site.SITE_E0 + sp["x"], site.SITE_N0 + sp["y"], sp["R"] + 2)
    exp = site.ANALYTIC["stockpile_volume_epochA_m3"]
    raw = volume_grid(xyz, poly, site.PAD_Z, cell=0.1, agg="mean").cut
    clean = volume_grid(xyz[keep], poly, site.PAD_Z, cell=0.1, agg="mean").cut
    metric("Volume", "FINDING: raw scan, mean grid 0.1 m (informational)", abs(raw - exp) / exp * 100, 100, "%")
    assert abs(clean - exp) < abs(raw - exp)


def test_geotiff_round_trip(tmp_path, metric):
    import rasterio

    pts = pyramid_points()
    xs = np.linspace(E0 - 5, E0 + 5, 201)
    gx, gy = np.meshgrid(xs, np.linspace(N0 - 5, N0 + 5, 201))
    z = np.clip(6 - 6 * np.maximum(np.abs(gx - E0), np.abs(gy - N0)) / 5, 0, None)
    dem = build_dem(np.column_stack([gx.ravel(), gy.ravel(), z.ravel()]), 0.5, None, agg="mean")
    path = tmp_path / "dem.tif"
    write_geotiff(dem, path)
    with rasterio.open(path) as ds:
        assert ds.crs.to_epsg() == 6677
        arr = ds.read(1)
        r, c = 3, 4
        x, y = ds.xy(r, c)  # pixel centre -> world
        rows = arr.shape[0]
        exp_x = dem.origin[0] + (c + 0.5) * dem.cell
        exp_y = dem.origin[1] + (rows - 1 - r + 0.5) * dem.cell
        err = max(abs(x - exp_x), abs(y - exp_y))
        metric("GeoTIFF", "DEM pixel centre -> world vs DEM grid", err * 1000, 0.1)
        assert err <= 1e-4
        assert arr[r, c] == pytest.approx(dem.z[rows - 1 - r, c], abs=1e-6)
    assert len(pts) == 5
