"""FastAPI application factory.

Run locally:  uvicorn app.main:create_app --factory --port 8000   (from backend/, after scripts/fetch_grids.py)
Environment:  SPL_DATA_DIR, SPL_DATABASE_URL, SPL_SEED (1/0), SPL_SEED_DENSITY (points/m², default 100)
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app import config
from app.db import Base, make_session_factory
from app.services import JobRunner, seed_demo
from app.storage import LocalStorage


def create_app(data_dir: Path | None = None, database_url: str | None = None, seed: bool | None = None,
               seed_density: float | None = None, sync_jobs: bool = False) -> FastAPI:
    data_dir = Path(data_dir or config.DATA_DIR)
    data_dir.mkdir(parents=True, exist_ok=True)
    url = database_url or os.environ.get("SPL_DATABASE_URL") or f"sqlite:///{(data_dir / 'spl.sqlite3').as_posix()}"
    engine, sessions = make_session_factory(url)
    Base.metadata.create_all(engine)  # Alembic migrations are used for Postgres; create_all keeps local dev simple

    app = FastAPI(title="Simple-Point Lite API", version="0.1.0",
                  description="Point cloud ingestion, survey measurement and analysis, JGD2011/JPGEO2024, DXF/SIMA.")
    app.state.engine = engine
    app.state.sessions = sessions
    app.state.storage = LocalStorage(data_dir)
    app.state.jobs = JobRunner(sessions, sync=sync_jobs)
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["*"], allow_headers=["*"])

    from app.api import analysis_routes, core_routes, interop_routes, photo_routes

    for r in (core_routes, analysis_routes, interop_routes, photo_routes):
        app.include_router(r.router)

    do_seed = seed if seed is not None else os.environ.get("SPL_SEED", "1") == "1"
    if do_seed:
        density = seed_density if seed_density is not None else float(os.environ.get("SPL_SEED_DENSITY", "100"))
        app.state.seed = seed_demo(SimpleNamespace(sessions=sessions, storage=app.state.storage, jobs=app.state.jobs), density)
    return app


logging.basicConfig(level=logging.INFO)
