"""docs/specs/measurement.md: Python twin must match the same golden vectors as the TypeScript code."""
import math

import pytest

from app.core.measure import measure, polygon_area, polyline_length

TARGET = 1e-6  # m; spec hard limit is 1e-4 m


def test_cases(golden_measurements, metric):
    worst = 0.0
    for c in golden_measurements["cases"]:
        m = measure(c["a"], c["b"]).to_dict()
        for k in ("dE", "dN", "dH", "horizontal", "distance3d"):
            err = abs(m[k] - c["expected"][k])
            worst = max(worst, err)
            assert err <= TARGET, (c["name"], k)
        for k in ("slopePercent", "slopeDegrees"):
            exp = c["expected"][k]
            if exp is None:
                assert m[k] is None, (c["name"], k)
            else:
                assert abs(m[k] - exp) <= 1e-6, (c["name"], k)
    metric("Measurements (Python)", f"max length error over {len(golden_measurements['cases'])} cases", worst * 1000, 0.1)


def test_polygons_and_polylines(golden_measurements):
    for p in golden_measurements["polygons"]:
        assert abs(polygon_area(p["points"]) - p["expectedArea"]) <= 1e-6, p["name"]
    for l in golden_measurements["polylines"]:
        assert abs(polyline_length(l["points"]) - l["expectedLength"]) <= TARGET, l["name"]


@pytest.mark.parametrize("p", [(0, 0, 0), (-5990.4321, -35360.8765, 4.0)])
def test_degenerate_pairs_are_finite(p):
    m = measure(p, p).to_dict()
    assert all(v is None or math.isfinite(v) for v in m.values())
