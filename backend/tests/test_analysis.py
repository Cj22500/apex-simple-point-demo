"""SOR cleaning, cross-section profile, change detection: against known truth."""
import numpy as np
import pytest

from app.core.analysis import extract_profile, statistical_outlier_removal, vertical_change
from app.synthetic import site


@pytest.fixture(scope="module")
def site_a():
    return site.generate_site("A", density=100)


def _crop(scan, x0, x1, y0, y1):
    m = (scan.local_xy[:, 0] >= x0) & (scan.local_xy[:, 0] < x1) & (scan.local_xy[:, 1] >= y0) & (scan.local_xy[:, 1] < y1)
    return m


def test_sor_finds_injected_outliers(site_a, metric):
    m = _crop(site_a, 10, 120, 10, 85)  # the pad + pit + stockpile (~800k points)
    xyz = site_a.points.xyz[m]
    truth = site_a.outlier[m]
    res = statistical_outlier_removal(xyz)  # platform default k = 16, n_sigma = 1.0
    removed = ~res.keep
    recall = (removed & truth).sum() / truth.sum()
    false_rate = (removed & ~truth).sum() / (~truth).sum()
    metric("Cleaning (SOR)", f"default k=16, nσ=1: outliers missed (of {int(truth.sum())})", (1 - recall) * 100, 1.0, "% missed")
    metric("Cleaning (SOR)", "default k=16, nσ=1: good points removed", false_rate * 100, 0.5, "%")
    assert recall >= 0.99
    assert false_rate <= 0.005
    pcl = statistical_outlier_removal(xyz, k=16, n_sigma=2.0)
    pcl_recall = ((~pcl.keep) & truth).sum() / truth.sum()
    metric("Cleaning (SOR)", "FINDING: PCL-style nσ=2 misses near-surface outliers (informational)", (1 - pcl_recall) * 100, 100, "% missed")


def test_profile_station_offset_exact():
    rng = np.random.default_rng(1)
    E0, N0 = -5995.1852, -35367.2301
    pts = np.column_stack([E0 + rng.uniform(0, 50, 20000), N0 + rng.uniform(0, 50, 20000), np.zeros(20000)])
    pts[:, 2] = 2.0 + 0.03 * (pts[:, 0] - E0) - 0.01 * (pts[:, 1] - N0)  # plane
    a, b = np.array([E0 + 5, N0 + 5]), np.array([E0 + 45, N0 + 35])
    p = extract_profile(pts, a, b, half_width=0.5, bin_size=0.5, ground_quantile=0.5)
    u = (b - a) / np.hypot(*(b - a))
    n = np.array([-u[1], u[0]])
    rel = pts[p.index, :2] - a
    assert np.max(np.abs(p.station - rel @ u)) < 1e-9
    assert np.max(np.abs(p.offset - rel @ n)) < 1e-9
    assert np.all(np.abs(p.offset) <= 0.5) and p.length == pytest.approx(50.0)
    # gradient of the plane along the section direction
    g = 0.03 * u[0] - 0.01 * u[1]
    fit = np.polyfit(p.ground_station, p.ground_z, 1)[0]
    assert fit == pytest.approx(g, abs=2e-4)


def test_profile_ramp_grade(site_a, metric):
    """Section along the 5 % ramp centreline: fitted grade of the ground line."""
    a = (site.SITE_E0 + 125, site.SITE_N0 + 45)
    b = (site.SITE_E0 + 165, site.SITE_N0 + 45)
    p = extract_profile(site_a.points.xyz, a, b, half_width=0.25, bin_size=0.25, ground_quantile=0.5,
                        cls=site_a.points.classification)
    grade = np.polyfit(p.ground_station, p.ground_z, 1)[0] * 100
    metric("Profile", "5 % ramp: fitted grade of the section ground line", abs(grade - 5.0), 0.01, "% grade")
    assert abs(grade - 5.0) <= 0.01


def test_change_detection_recovers_settlement_bowl(metric):
    a = site.generate_site("A", density=25)
    b = site.generate_site("B", density=25)
    res = vertical_change(a.points.xyz, b.points.xyz, k=12)
    bl = site.BOWL
    x, y = b.local_xy[:, 0], b.local_xy[:, 1]
    truth = site.ground_z(x, y, "B") - site.ground_z(x, y, "A")
    ground = (b.points.classification == site.CLS_GROUND) & ~b.outlier
    centre = ground & (np.hypot(x - bl["x"], y - bl["y"]) < 1.0)
    measured_max = float(np.median(res.dz[centre]))
    metric("Change detection", "settlement bowl centre: median ΔZ vs −45 mm", abs(measured_max - bl["amplitude"]) * 1000, 2.0)
    assert abs(measured_max - bl["amplitude"]) <= 0.002
    pad = ground & (x > 12) & (x < 118) & (y > 12) & (y < 83) & (site.pit_depth(x, y) == 0) & (site.stockpile_height(x, y) == 0)
    err = res.dz[pad] - truth[pad]
    err = err[np.isfinite(err)]
    rmse = float(np.sqrt(np.mean(err**2)))
    metric("Change detection", "RMSE vs analytic ΔZ field on the pad (σ 3 mm noise)", rmse * 1000, 5.0)
    assert rmse <= 0.005
    # ground is fully supported; vertical faces (building/retaining walls) are excluded, not extrapolated
    assert np.isfinite(res.dz[ground]).mean() > 0.99
    walls = (b.points.classification == site.CLS_BUILDING) & (b.points.xyz[:, 2] < site.BUILDING_ROOF_Z - 0.5)
    assert np.isnan(res.dz[walls]).mean() > 0.9
    metric("Change detection", "ΔZ p99 |value| on unchanged + changed ground (no wall blow-ups)", float(np.nanpercentile(np.abs(res.dz[ground]), 99)) * 1000, 100.0)


def test_change_on_slopes_is_unbiased(metric):
    """Plane fit vs nearest-neighbour: on the 1:0.5 pit walls (no real change) bias must be ~0."""
    a = site.generate_site("A", density=25)
    b = site.generate_site("B", density=25)
    res = vertical_change(a.points.xyz, b.points.xyz, k=12)
    x, y = b.local_xy[:, 0], b.local_xy[:, 1]
    d = site.pit_depth(x, y)
    wall = (d > 0.3) & (d < 2.7) & ~b.outlier
    bias = float(np.nanmedian(res.dz[wall]))
    metric("Change detection", "median ΔZ on unchanged 1:0.5 pit walls (bias)", abs(bias) * 1000, 3.0)
    assert abs(bias) <= 0.003
