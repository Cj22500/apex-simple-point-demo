"""The synthetic site's analytic truth must itself be right: cross-check closed forms numerically."""
import numpy as np

from app.synthetic import site


def _integrate(fn, rect, step=0.01):
    x0, x1, y0, y1 = rect
    xs = np.arange(x0 + step / 2, x1, step)
    ys = np.arange(y0 + step / 2, y1, step)
    total = 0.0
    for yrow in np.array_split(ys, 20):  # chunk to bound memory
        gx, gy = np.meshgrid(xs, yrow)
        total += fn(gx, gy).sum() * step * step
    return total


def test_site_truth_matches_decimal_golden(golden_volumes):
    """Site formulas (float) agree with the 50-digit decimal golden values."""
    assert abs(site.ANALYTIC["pit_volume_design_m3"] - golden_volumes["pit_prismoid"]["volume"]) < 1e-9
    assert abs(site.ANALYTIC["stockpile_volume_epochA_m3"] - golden_volumes["stockpile_frustum"]["volume"]) < 1e-9


def test_pit_prismoidal_volume_matches_numeric_integration(metric):
    num = _integrate(site.pit_depth, site.PIT_TOP)
    err = abs(num - site.ANALYTIC["pit_volume_design_m3"])
    metric("Synthetic site truth", "pit volume: prismoidal formula vs numeric integration", err, 0.01, "m³")
    assert err < 0.01


def test_stockpile_frustum_volume_matches_numeric_integration(metric):
    s = site.STOCKPILE
    rect = (s["x"] - s["R"], s["x"] + s["R"], s["y"] - s["R"], s["y"] + s["R"])
    num = _integrate(site.stockpile_height, rect)
    err = abs(num - site.ANALYTIC["stockpile_volume_epochA_m3"])
    metric("Synthetic site truth", "stockpile volume: frustum formula vs numeric integration", err, 0.01, "m³")
    assert err < 0.01


def test_defect_is_contained_in_pit_floor():
    d = site.DEFECT
    num = _integrate(lambda x, y: -site.defect(x, y), (d["x"] - 6, d["x"] + 6, d["y"] - 6, d["y"] + 6))
    assert abs(num - site.ANALYTIC["pit_defect_volume_m3"]) < 1e-4
    # floor edge is >= 3.5 m = 4.4 sigma away: < 0.1 mm leakage onto the walls (measured 0.014 mm)
    assert abs(site.defect(np.array([d["x"]]), np.array([d["y"] + 3.5]))[0]) < 1e-4


def test_ramp_grade_is_exactly_five_percent():
    z = site.ground_z(np.array([130.0, 160.0]), np.array([45.0, 45.0]))
    assert abs((z[1] - z[0]) / 30.0 - 0.05) < 1e-12
    assert abs(site.ground_z(np.array([180.0]), np.array([45.0]))[0] - 5.5) < 1e-12


def test_surface_is_continuous():
    # no vertical jumps in the ground model on a fine transect across pad edge, ramp and pit
    x = np.linspace(0, 200, 200_001)
    for yline in (35.0, 45.0, 60.0, 88.0):
        z = site.ground_z(x, np.full_like(x, yline))
        assert np.max(np.abs(np.diff(z))) < 0.003, yline  # 1 mm step -> max 2 per mm (1:0.5 walls)


def test_generated_scan_statistics():
    s = site.generate_site("A", density=4)
    ground = s.points.classification == site.CLS_GROUND
    resid = s.points.xyz[ground & ~s.outlier, 2] - s.ideal_z[ground & ~s.outlier]
    assert abs(resid.std() - site.NOISE_SIGMA) < 0.0003
    assert abs(s.outlier.mean() - site.OUTLIER_FRACTION) < 0.0005
    # absolute coordinates are in Zone IX near Toyosu
    assert np.all(s.points.xyz[:, 0] > site.SITE_E0 - 1) and np.all(s.points.xyz[:, 1] < site.SITE_N0 + 141)


def test_epoch_b_differs_by_bowl_and_stockpile():
    x, y = np.array([site.BOWL["x"]]), np.array([site.BOWL["y"]])
    assert abs(site.ground_z(x, y, "B")[0] - site.ground_z(x, y, "A")[0] - site.BOWL["amplitude"]) < 1e-12


def test_control_points_on_surface():
    for cp in site.control_points():
        lx, ly = cp["local"]
        assert abs(cp["H"] - site.ground_z(np.array([lx]), np.array([ly]))[0]) < 5e-5
