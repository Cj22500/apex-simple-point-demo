"""docs/specs/crs-geoid.md acceptance criteria, against GSI official calculator values."""
import numpy as np
import pytest

from app.core import crs
from app.core.crs import GeoidModel

needs_grids = pytest.mark.skipif(
    not (crs.geoid_available(GeoidModel.JPGEO2024) and crs.geoid_available(GeoidModel.GSIGEO2011)),
    reason="geoid grids missing: run scripts/fetch_grids.py",
)


def test_zone_ix_origin_maps_to_zero(metric):
    X, Y = crs.geographic_to_plane(36.0, 139.0 + 50.0 / 60.0)
    metric("CRS", "Zone IX origin -> (0, 0)", float(np.hypot(X, Y)) * 1000, 0.1)
    assert abs(float(X)) <= 1e-4 and abs(float(Y)) <= 1e-4


def test_plane_vs_gsi_reference(golden_crs, metric):
    pts = golden_crs["points"]
    X, Y = crs.geographic_to_plane([p["lat"] for p in pts], [p["lon"] for p in pts])
    dX = X - np.array([p["X"] for p in pts])
    dY = Y - np.array([p["Y"] for p in pts])
    tol = golden_crs["tolerance"]["plane_m"]
    metric("CRS", "lat/lon -> Zone IX vs GSI calculator (7 pts, max |dX|,|dY|)", float(max(np.max(np.abs(dX)), np.max(np.abs(dY)))) * 1000, 0.1)
    assert np.max(np.abs(dX)) <= tol, dX
    assert np.max(np.abs(dY)) <= tol, dY


def test_axis_order_is_x_north_y_east():
    # Tokyo Station is ~35 km south and ~6 km west of the Zone IX origin.
    X, Y = crs.geographic_to_plane(35.6812, 139.7671)
    assert -36000 < float(X) < -35000  # north-south component
    assert -6500 < float(Y) < -5500  # east-west component
    E, N = crs.plane_to_enu(X, Y)
    assert float(E) == float(Y) and float(N) == float(X)


def test_round_trip_1000_points(metric):
    rng = np.random.default_rng(42)
    lat = rng.uniform(35.0, 37.5, 1000)
    lon = rng.uniform(138.4, 141.0, 1000)
    X, Y = crs.geographic_to_plane(lat, lon)
    lat2, lon2 = crs.plane_to_geographic(X, Y)
    dn = (lat2 - lat) * 111_320.0
    de = (lon2 - lon) * 111_320.0 * np.cos(np.radians(lat))
    worst = float(np.max(np.hypot(dn, de)))
    metric("CRS", "round trip lat/lon -> IX -> lat/lon (1,000 pts)", worst * 1000, 0.1)
    assert worst <= 1e-4


@needs_grids
def test_jpgeo2024_vs_gsi_reference(golden_crs, metric):
    pts = golden_crs["points"]
    N, info = crs.geoid_undulation([p["lat"] for p in pts], [p["lon"] for p in pts], GeoidModel.JPGEO2024)
    assert info.model is GeoidModel.JPGEO2024 and not info.approximate
    err = N - np.array([p["N_jpgeo2024"] for p in pts])
    metric("Geoid", "JPGEO2024 N vs GSI calculator (7 pts)", float(np.max(np.abs(err))) * 1000, 0.1)
    assert np.max(np.abs(err)) <= golden_crs["tolerance"]["geoid_m"], err


@needs_grids
def test_gsigeo2011_vs_reference(golden_crs, metric):
    ref = golden_crs["gsigeo2011_reference"]
    N, _ = crs.geoid_undulation([p["lat"] for p in ref["points"]], [p["lon"] for p in ref["points"]], GeoidModel.GSIGEO2011)
    err = N - np.array([p["N"] for p in ref["points"]])
    metric("Geoid", "GSIGEO2011 N vs published reference (7 pts)", float(np.max(np.abs(err))) * 1000, 0.1)
    assert np.max(np.abs(err)) <= ref["tolerance_m"], err


@needs_grids
def test_legacy_geoid_differs_by_about_10cm_in_tokyo(metric):
    """Documented finding: using the legacy model in Tokyo gives a ~10 cm height error."""
    n24, _ = crs.geoid_undulation(35.6812, 139.7671, GeoidModel.JPGEO2024)
    n11, _ = crs.geoid_undulation(35.6812, 139.7671, GeoidModel.GSIGEO2011)
    diff = float(n24[0] - n11[0])
    metric("Geoid", "FINDING: JPGEO2024 - GSIGEO2011 at Tokyo Station (informational)", diff * 1000, 130.0)
    assert 0.07 < diff < 0.13


@needs_grids
def test_orthometric_round_trip():
    H, info = crs.ellipsoidal_to_orthometric(35.6812, 139.7671, 50.0)
    assert abs(float(H[0]) - (50.0 - 36.7613)) <= 1e-4
    h, _ = crs.orthometric_to_ellipsoidal(35.6812, 139.7671, H)
    assert abs(float(h[0]) - 50.0) <= 1e-9


def test_fallback_is_flagged(monkeypatch, tmp_path):
    monkeypatch.setattr(crs.config, "PROJ_GRID_DIR", tmp_path)  # empty dir: no grids
    crs._geoid_transformer.cache_clear()
    N, info = crs.geoid_undulation(35.6812, 139.7671, GeoidModel.JPGEO2024)
    assert info.approximate and info.model is GeoidModel.CONSTANT
    assert "fetch_grids" in info.note
    assert float(N[0]) == crs.config.FALLBACK_GEOID_N


@needs_grids
def test_outside_coverage_raises():
    with pytest.raises(crs.OutsideGeoidCoverage):
        crs.geoid_undulation(10.0, 100.0, GeoidModel.JPGEO2024)  # Thailand
