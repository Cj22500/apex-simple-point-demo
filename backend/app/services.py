"""Background jobs and dataset ingestion.

Locally jobs run on a small thread pool; in AWS the same `process_*` functions run in an ECS
Fargate worker that consumes an SQS queue (see infra/). Jobs are persisted, so the API and the UI
only ever poll the Job row.
"""
from __future__ import annotations

import logging
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import sessionmaker

from app.core import pcio
from app.core.octree import OctreeConfig, build_octree
from app.core.pointset import PointSet
from app.db import Dataset, Job, Project, ProjectMember, Tenant, User
from app.storage import LocalStorage

log = logging.getLogger("spl")


class JobRunner:
    def __init__(self, sessions: sessionmaker, sync: bool = False, workers: int = 2):
        self.sessions = sessions
        self.sync = sync
        self.pool = None if sync else ThreadPoolExecutor(max_workers=workers, thread_name_prefix="spl-job")

    def submit(self, tenant_id: str, kind: str, fn: Callable[[Callable[[float], None]], dict], dataset_id: str | None = None) -> str:
        with self.sessions() as s:
            job = Job(tenant_id=tenant_id, kind=kind, dataset_id=dataset_id)
            s.add(job)
            s.commit()
            job_id = job.id
        if self.sync:
            self._run(job_id, fn)
        else:
            self.pool.submit(self._run, job_id, fn)
        return job_id

    def _set(self, job_id: str, **fields) -> None:
        with self.sessions() as s:
            job = s.get(Job, job_id)
            for k, v in fields.items():
                setattr(job, k, v)
            s.commit()

    def _run(self, job_id: str, fn) -> None:
        self._set(job_id, status="running", progress=0.0)
        try:
            result = fn(lambda p: self._set(job_id, progress=float(p)))
            self._set(job_id, status="done", progress=1.0, result=result or {})
        except Exception as exc:  # noqa: BLE001  (record any failure on the job row)
            log.error("job %s failed: %s", job_id, traceback.format_exc())
            self._set(job_id, status="failed", error=str(exc)[:2000])


def _process_pointset(storage: LocalStorage, sessions: sessionmaker, dataset_id: str, ps: PointSet, progress) -> dict:
    storage.save_arrays(dataset_id, ps)
    progress(0.3)
    h = build_octree(ps, storage.octree_dir(dataset_id), OctreeConfig())
    progress(0.95)
    with sessions() as s:
        ds = s.get(Dataset, dataset_id)
        ds.status = "ready"
        ds.point_count = len(ps)
        ds.meta = {**(ds.meta or {}), "bounds": h["bounds"], "stats": h["stats"], "nodes": len(h["nodes"]),
                   "attributes": h["attributes"]["extras"]}
        s.commit()
    return {"dataset_id": dataset_id, "points": len(ps), "nodes": len(h["nodes"])}


def _mark_failed(sessions, dataset_id):
    with sessions() as s:
        ds = s.get(Dataset, dataset_id)
        if ds and ds.status != "ready":
            ds.status = "failed"
            s.commit()


def ingest_pointset(app_state, tenant_id: str, project_id: str, name: str, ps: PointSet, source_format: str,
                    epoch: str | None = None, parent_id: str | None = None, meta: dict | None = None) -> tuple[str, str]:
    sessions, storage, runner = app_state.sessions, app_state.storage, app_state.jobs
    with sessions() as s:
        ds = Dataset(tenant_id=tenant_id, project_id=project_id, name=name, epoch=epoch, parent_id=parent_id,
                     source_format=source_format, meta=meta or {})
        s.add(ds)
        s.commit()
        dataset_id = ds.id

    def work(progress):
        try:
            return _process_pointset(storage, sessions, dataset_id, ps, progress)
        except Exception:
            _mark_failed(sessions, dataset_id)
            raise

    job_id = runner.submit(tenant_id, "ingest", work, dataset_id)
    return dataset_id, job_id


def ingest_file(app_state, tenant_id: str, project_id: str, name: str, path: Path, epoch: str | None = None) -> tuple[str, str]:
    fmt = pcio.detect_format(path)  # fail fast (400) on unknown formats before creating rows
    sessions, storage, runner = app_state.sessions, app_state.storage, app_state.jobs
    with sessions() as s:
        ds = Dataset(tenant_id=tenant_id, project_id=project_id, name=name, epoch=epoch, source_format=fmt)
        s.add(ds)
        s.commit()
        dataset_id = ds.id

    def work(progress):
        try:
            ps = pcio.read_points(path)
            progress(0.1)
            return _process_pointset(storage, sessions, dataset_id, ps, progress)
        except Exception:
            _mark_failed(sessions, dataset_id)
            raise
        finally:
            Path(path).unlink(missing_ok=True)

    job_id = runner.submit(tenant_id, "ingest", work, dataset_id)
    return dataset_id, job_id


# ------------------------------------------------------------------ demo seed
def seed_demo(app_state, density: float = 100.0) -> dict:
    """Create demo tenants/users/project and ingest both synthetic epochs (idempotent)."""
    from app.synthetic import site

    sessions = app_state.sessions
    with sessions() as s:
        if s.query(Tenant).filter_by(name="APEX Demo").one_or_none():
            return {"seeded": False}
        apex = Tenant(name="APEX Demo")
        other = Tenant(name="Other Construction Co.")
        s.add_all([apex, other])
        s.flush()
        owner = User(tenant_id=apex.id, email="demo@example.com", name="Demo Surveyor")
        viewer = User(tenant_id=apex.id, email="viewer@example.com", name="Site Viewer")
        outsider = User(tenant_id=other.id, email="other@example.com", name="Other Tenant User")
        s.add_all([owner, viewer, outsider])
        s.flush()
        proj = Project(tenant_id=apex.id, name="Toyosu Construction Site (synthetic)")
        other_proj = Project(tenant_id=other.id, name="Other tenant's private project")
        s.add_all([proj, other_proj])
        s.flush()
        s.add_all([
            ProjectMember(project_id=proj.id, user_id=owner.id, role="owner"),
            ProjectMember(project_id=proj.id, user_id=viewer.id, role="viewer"),
            ProjectMember(project_id=other_proj.id, user_id=outsider.id, role="owner"),
        ])
        s.commit()
        ids = {"tenant": apex.id, "project": proj.id, "owner": owner.id, "viewer": viewer.id,
               "outsider": outsider.id, "other_project": other_proj.id}

    truth = site.site_truth()
    for epoch, label in (("A", "Epoch A: 2026-10-01 TLS scan"), ("B", "Epoch B: 2026-11-01 TLS scan")):
        scan = site.generate_site(epoch, density=density)
        ingest_pointset(app_state, ids["tenant"], ids["project"], label, scan.points, "synthetic", epoch=epoch,
                        meta={"synthetic": True, "truth": truth, "density": density})
    return {"seeded": True, **ids}
