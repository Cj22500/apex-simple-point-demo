"""Coordinate reference systems and geoid. Spec: docs/specs/crs-geoid.md

Conventions
- Geographic input is JGD2011 (EPSG:6668). WGS84 (EPSG:4326) is treated as identical (< 1 cm,
  documented assumption; RTK in Japan is referenced to JGD2011 via the GEONET CORS network).
- Plane coordinates: JGD2011 / Japan Plane Rectangular CS IX (EPSG:6677), returned as
  X = northing, Y = easting (Japanese surveying convention and the EPSG axis order).
- Heights: h = ellipsoidal (GNSS), N = geoid undulation, H = h - N = orthometric (標高).
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from functools import lru_cache

import numpy as np
from pyproj import Transformer

from app import config

EPSG_GEOGRAPHIC = 6668
EPSG_PLANE_IX = 6677


class GeoidModel(str, Enum):
    JPGEO2024 = "jpgeo2024"  # official since 2025-04-01
    GSIGEO2011 = "gsigeo2011"  # legacy
    CONSTANT = "constant"  # fallback, approximate

GRID_FILES = {
    GeoidModel.JPGEO2024: "jp_gsi_jpgeo2024.tif",
    GeoidModel.GSIGEO2011: "jp_gsi_gsigeo2011.tif",
}


@dataclass(frozen=True)
class GeoidInfo:
    model: GeoidModel
    approximate: bool
    note: str = ""

    def to_dict(self) -> dict:
        return {"model": self.model.value, "approximate": self.approximate, "note": self.note}


class OutsideGeoidCoverage(ValueError):
    pass


@lru_cache(maxsize=1)
def _to_plane() -> Transformer:
    # Authority axis order: (lat, lon) -> (X north, Y east). always_xy=False on purpose.
    return Transformer.from_crs(EPSG_GEOGRAPHIC, EPSG_PLANE_IX, always_xy=False)


@lru_cache(maxsize=1)
def _to_geographic() -> Transformer:
    return Transformer.from_crs(EPSG_PLANE_IX, EPSG_GEOGRAPHIC, always_xy=False)


def geographic_to_plane(lat, lon) -> tuple[np.ndarray, np.ndarray]:
    """Latitude/longitude (deg) -> (X north, Y east) metres in Zone IX."""
    X, Y = _to_plane().transform(np.asarray(lat, dtype=np.float64), np.asarray(lon, dtype=np.float64))
    return np.asarray(X), np.asarray(Y)


def plane_to_geographic(X, Y) -> tuple[np.ndarray, np.ndarray]:
    """(X north, Y east) metres in Zone IX -> latitude/longitude (deg)."""
    lat, lon = _to_geographic().transform(np.asarray(X, dtype=np.float64), np.asarray(Y, dtype=np.float64))
    return np.asarray(lat), np.asarray(lon)


def grid_path(model: GeoidModel):
    return config.PROJ_GRID_DIR / GRID_FILES[model]


def geoid_available(model: GeoidModel) -> bool:
    return model in GRID_FILES and grid_path(model).is_file()


@lru_cache(maxsize=4)
def _geoid_transformer(model: GeoidModel) -> Transformer:
    g = grid_path(model).as_posix()
    # vgridshift: z_out = z_in + multiplier * N. With z_in = 0 and multiplier = 1, z_out = N.
    pipeline = (
        "+proj=pipeline "
        "+step +proj=axisswap +order=2,1 "
        "+step +proj=unitconvert +xy_in=deg +xy_out=rad "
        f"+step +proj=vgridshift +grids={g} +multiplier=1 "
        "+step +proj=unitconvert +xy_in=rad +xy_out=deg "
        "+step +proj=axisswap +order=2,1"
    )
    return Transformer.from_pipeline(pipeline)


def geoid_undulation(lat, lon, model: GeoidModel = GeoidModel.JPGEO2024) -> tuple[np.ndarray, GeoidInfo]:
    """Geoid height N (m) above the GRS80 ellipsoid. Falls back to a constant, flagged as approximate."""
    lat = np.atleast_1d(np.asarray(lat, dtype=np.float64))
    lon = np.atleast_1d(np.asarray(lon, dtype=np.float64))
    if model is not GeoidModel.CONSTANT and geoid_available(model):
        _, _, N = _geoid_transformer(model).transform(lat, lon, np.zeros_like(lat))
        N = np.asarray(N, dtype=np.float64)
        if not np.all(np.isfinite(N)) or np.any(np.abs(N) > 200):
            raise OutsideGeoidCoverage(f"point(s) outside {model.value} grid coverage")
        return N, GeoidInfo(model, approximate=False)
    note = (
        f"{model.value} grid not found in {config.PROJ_GRID_DIR}; using constant N = {config.FALLBACK_GEOID_N} m. "
        "Run scripts/fetch_grids.py for exact heights."
        if model is not GeoidModel.CONSTANT
        else f"constant N = {config.FALLBACK_GEOID_N} m"
    )
    return np.full_like(lat, config.FALLBACK_GEOID_N), GeoidInfo(GeoidModel.CONSTANT, approximate=True, note=note)


def ellipsoidal_to_orthometric(lat, lon, h, model: GeoidModel = GeoidModel.JPGEO2024):
    N, info = geoid_undulation(lat, lon, model)
    return np.asarray(h, dtype=np.float64) - N, info


def orthometric_to_ellipsoidal(lat, lon, H, model: GeoidModel = GeoidModel.JPGEO2024):
    N, info = geoid_undulation(lat, lon, model)
    return np.asarray(H, dtype=np.float64) + N, info


def plane_to_enu(X, Y) -> tuple[np.ndarray, np.ndarray]:
    """Japanese plane (X north, Y east) -> internal (E, N)."""
    return np.asarray(Y), np.asarray(X)


def enu_to_plane(E, N) -> tuple[np.ndarray, np.ndarray]:
    """Internal (E, N) -> Japanese plane (X north, Y east)."""
    return np.asarray(N), np.asarray(E)
