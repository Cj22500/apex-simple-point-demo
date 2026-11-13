"""FastAPI application factory.

Run locally:  uvicorn app.main:create_app --factory --port 8000   (from backend/, after scripts/fetch_grids.py)
Environment:  SPL_DATA_DIR, SPL_DATABASE_URL, SPL_SEED (1/0), SPL_SEED_DENSITY (points/m², default 100)
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote_plus

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app import config
from app.db import Base, make_session_factory
from app.errors import CodedHTTPException
from app.services import JobRunner, seed_demo
from app.storage import LocalStorage


def _resolve_database_url(data_dir: Path, database_url: str | None = None) -> str:
    """Resolve the database URL from explicit argument, SPL_DATABASE_URL, SPL_DB_* vars, or local SQLite."""
    if database_url:
        return database_url
    env_url = os.environ.get("SPL_DATABASE_URL", "").strip()
    if env_url:
        return env_url
    host = os.environ.get("SPL_DB_HOST", "").strip()
    if host:
        user = os.environ.get("SPL_DB_USER", "").strip()
        password = os.environ.get("SPL_DB_PASSWORD", "")
        name = os.environ.get("SPL_DB_NAME", "").strip()
        missing = [k for k, v in (("SPL_DB_USER", user), ("SPL_DB_PASSWORD", password), ("SPL_DB_NAME", name)) if not v]
        if missing:
            raise ValueError(f"SPL_DB_HOST is set, but required database env vars are missing: {', '.join(missing)}")
        port_raw = os.environ.get("SPL_DB_PORT", "").strip() or "5432"
        try:
            port = int(port_raw)
        except ValueError as exc:
            raise ValueError(f"invalid SPL_DB_PORT: {port_raw!r}") from exc
        if not (1 <= port <= 65535):
            raise ValueError(f"invalid SPL_DB_PORT: {port_raw!r}")
        return f"postgresql+psycopg://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(name)}"
    return f"sqlite:///{(data_dir / 'spl.sqlite3').as_posix()}"


def create_app(data_dir: Path | None = None, database_url: str | None = None, seed: bool | None = None,
               seed_density: float | None = None, sync_jobs: bool = False) -> FastAPI:
    storage_backend = os.environ.get("SPL_STORAGE", "local").strip().lower()
    if storage_backend == "s3":
        raise NotImplementedError("S3 storage adapter not implemented yet; the worker (app/worker.py) is S3-aware")
    if storage_backend != "local":
        raise ValueError(f"unsupported SPL_STORAGE backend: {storage_backend!r}")
    data_dir = Path(data_dir or config.DATA_DIR)
    data_dir.mkdir(parents=True, exist_ok=True)
    url = _resolve_database_url(data_dir, database_url)
    engine, sessions = make_session_factory(url)
    Base.metadata.create_all(engine)  # Alembic migrations are used for Postgres; create_all keeps local dev simple

    app = FastAPI(title="Simple-Point Lite API", version="0.1.0",
                  description="Point cloud ingestion, survey measurement and analysis, JGD2011/JPGEO2024, DXF/SIMA.")

    @app.exception_handler(CodedHTTPException)
    async def _coded_http_exception_handler(_request, exc: CodedHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": exc.code, "params": exc.params or {}},
            headers=exc.headers,
        )

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
