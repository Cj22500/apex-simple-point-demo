"""Runtime configuration (environment variables with sensible local defaults)."""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("SPL_DATA_DIR", REPO_ROOT / "data")).resolve()
PROJ_GRID_DIR = Path(os.environ.get("SPL_PROJ_GRID_DIR", DATA_DIR / "proj")).resolve()
DATASETS_DIR = DATA_DIR / "datasets"
DATABASE_URL = os.environ.get("SPL_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'spl.sqlite3').as_posix()}")
# Geoid undulation used only when the grid file is unavailable (Tokyo Station, JPGEO2024).
FALLBACK_GEOID_N = float(os.environ.get("SPL_FALLBACK_GEOID_N", "36.7613"))
