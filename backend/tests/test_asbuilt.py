"""docs/specs/asbuilt.md: deviations, pass/fail counts, crest/toe exclusion, density."""
import numpy as np

from app.core import asbuilt
from app.synthetic import site


def design():
    return site.design_tin()


def grid_points(spacing=0.2):
    x0, x1, y0, y1 = site.PAD
    xs = np.arange(x0 + spacing / 2, x1, spacing)
    ys = np.arange(y0 + spacing / 2, y1, spacing)
    gx, gy = np.meshgrid(xs, ys)
    return gx.ravel(), gy.ravel()


def test_known_offset_field_is_reproduced(metric):
    verts, tris = design()
    x, y = grid_points()
    offset = 0.03 * np.sin(x / 7) * np.cos(y / 5)  # known deviation field, |.| <= 30 mm
    xyz = np.column_stack([x + site.SITE_E0, y + site.SITE_N0, site.design_z(x, y) + offset])
    r = asbuilt.inspect(xyz, verts, tris)
    err = np.max(np.abs(r.dz - offset[r.index]))
    metric("As-built", "deviation vs known offset field (max error)", err * 1000, 1.0)
    assert err <= 0.001
    assert r.summary["pass"] and r.summary["flat"]["pass"] and r.summary["slope"]["pass"]
    assert r.summary["slope"]["points"] > 0 and r.summary["flat"]["points"] > 0


def test_pass_fail_counts_exact():
    verts, tris = design()
    x, y = grid_points()
    dz = np.zeros_like(x)
    flat = site.pit_depth(x, y) == 0  # pad + exactly-flat floor are flat; walls are slope
    # pick 37 flat apron points away from breaklines and push them 0.20 m down (over-dig)
    far = flat & (x > 25.5) & (x < 29.0) & (y > 26) & (y < 44)
    bad = np.nonzero(far)[0][:37]
    dz[bad] = -0.20
    xyz = np.column_stack([x + site.SITE_E0, y + site.SITE_N0, site.design_z(x, y) + dz])
    r = asbuilt.inspect(xyz, verts, tris)
    assert r.summary["flat"]["exceeding_individual"] == 37
    assert r.summary["flat"]["pass"] is False and r.summary["pass"] is False
    assert r.summary["slope"]["exceeding_individual"] == 0


def test_crest_toe_exclusion():
    verts, tris = design()
    # points exactly on the pit rim line (crest) and 4 cm / 6 cm inside the pad from it
    xs = np.linspace(32, 48, 9)
    rim_y = site.PIT_TOP[2]
    y_on, y_4, y_6 = np.full(9, rim_y), np.full(9, rim_y - 0.04), np.full(9, rim_y - 0.06)
    x = np.concatenate([xs, xs, xs])
    y = np.concatenate([y_on, y_4, y_6])
    xyz = np.column_stack([x + site.SITE_E0, y + site.SITE_N0, site.design_z(x, y)])
    r = asbuilt.inspect(xyz, verts, tris)
    assert r.summary["excluded_near_breaklines"] == 18  # on the line and 4 cm away
    assert set(r.index.tolist()) == set(range(18, 27))  # the 6 cm points are evaluated


def test_density_check_flags_empty_cells():
    verts, tris = design()
    x, y = grid_points(spacing=0.5)
    hole = (x > 26) & (x < 29) & (y > 41) & (y < 43)  # remove a 3 x 2 m apron patch -> 6 empty 1 m cells
    x, y = x[~hole], y[~hole]
    xyz = np.column_stack([x + site.SITE_E0, y + site.SITE_N0, site.design_z(x, y)])
    r = asbuilt.inspect(xyz, verts, tris)
    assert r.summary["density"]["cells_below_min"] == 6
    assert r.summary["density"]["pass"] is False


def test_synthetic_scan_finds_the_over_dig(metric):
    """Full pipeline on the synthetic site (raw minus injected outliers): the -0.20 m defect fails."""
    s = site.generate_site("A", density=16)
    verts, tris = design()
    ok = ~s.outlier & (s.points.classification == site.CLS_GROUND)
    r = asbuilt.inspect(s.points.xyz[ok], verts, tris)
    flat = r.summary["flat"]
    metric("As-built", "synthetic site: flat-area mean deviation", abs(flat["mean_m"]) * 1000, 50.0)
    assert flat["exceeding_individual"] > 0 and r.summary["pass"] is False
    assert abs(flat["mean_m"]) < 0.05  # mean still within ±50 mm: only the individual rule fails


def test_boundary_point_on_gmax_does_not_wrap_or_crash():
    verts = np.array([[0.0, 0.0, 1.0], [2.0, 0.0, 1.0], [2.0, 2.0, 1.0], [0.0, 2.0, 1.0]])
    tris = np.array([[0, 1, 2], [0, 2, 3]])
    xyz = np.array([
        [0.5, 0.5, 1.0],
        [1.5, 0.5, 1.0],
        [0.5, 1.5, 1.0],
        [1.5, 1.5, 1.0],
        [2.0, 0.5, 1.1],  # on xmax: previously wrapped into cell (0, 1)
        [2.0, 2.0, 1.2],  # on (xmax, ymax): previously caused bincount shape mismatch
    ])
    r = asbuilt.inspect(xyz, verts, tris)
    assert r.cells["cols"] == 3 and r.cells["rows"] == 3
    cell_0_1 = 1 * r.cells["cols"] + 0
    assert r.cells["count"][cell_0_1] == 1
    assert r.cells["mean_dz"][cell_0_1] == 0.0
    assert r.summary["density"]["cells"] == 4
    assert r.summary["density"]["cells_below_min"] == 0


def test_all_flat_tin_has_empty_slope_summary():
    verts = np.array([[0.0, 0.0, 3.0], [2.0, 0.0, 3.0], [2.0, 2.0, 3.0], [0.0, 2.0, 3.0]])
    tris = np.array([[0, 1, 2], [0, 2, 3]])
    xyz = np.array([[0.5, 0.5, 3.0], [1.5, 0.5, 3.0], [0.5, 1.5, 3.0], [1.5, 1.5, 3.0]])
    r = asbuilt.inspect(xyz, verts, tris)
    assert r.summary["slope"] == {"points": 0}
    assert r.summary["flat"]["points"] == 4
    assert r.summary["pass"] is True
