"""Auth, projects, datasets, octree tiles, jobs, measurements and CRS endpoints."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import services
from app.auth import current_user, get_db, issue_token, project_for
from app.core import crs, pcio
from app.core.measure import measure, polygon_area, polyline_length
from app.db import Dataset, Job, Measurement, Project, ProjectMember, User

router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ helpers
def dataset_for(db: Session, user: User, dataset_id: str, min_role: str = "viewer") -> Dataset:
    ds = db.get(Dataset, dataset_id)
    if ds is None or ds.tenant_id != user.tenant_id:
        raise HTTPException(404, "dataset not found")
    project_for(db, user, ds.project_id, min_role)
    return ds


def dataset_json(ds: Dataset) -> dict:
    return {"id": ds.id, "projectId": ds.project_id, "parentId": ds.parent_id, "name": ds.name, "epoch": ds.epoch,
            "sourceFormat": ds.source_format, "status": ds.status, "pointCount": ds.point_count,
            "meta": ds.meta, "createdAt": ds.created_at.isoformat()}


# ------------------------------------------------------------------ auth
@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.post("/auth/dev-token")
def dev_token(request: Request, email: str = "demo@example.com", db: Session = Depends(get_db)) -> dict:
    """Local demo login. Disabled when SPL_DEV_AUTH=0 (production uses Cognito)."""
    if os.environ.get("SPL_DEV_AUTH", "1") != "1":
        raise HTTPException(404)
    user = db.query(User).filter_by(email=email).one_or_none()
    if user is None:
        raise HTTPException(404, "unknown demo user")
    return {"token": issue_token(user.id), "user": {"id": user.id, "name": user.name, "email": user.email}}


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email, "tenantId": user.tenant_id}


# ------------------------------------------------------------------ projects & datasets
@router.get("/projects")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = (db.query(Project, ProjectMember.role).join(ProjectMember, ProjectMember.project_id == Project.id)
            .filter(Project.tenant_id == user.tenant_id, ProjectMember.user_id == user.id).all())
    return [{"id": p.id, "name": p.name, "crs": p.crs, "geoidModel": p.geoid_model, "role": role} for p, role in rows]


@router.get("/projects/{project_id}/datasets")
def list_datasets(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    project_for(db, user, project_id)
    rows = db.query(Dataset).filter_by(project_id=project_id, tenant_id=user.tenant_id).order_by(Dataset.created_at).all()
    return [dataset_json(d) for d in rows]


@router.post("/projects/{project_id}/datasets", status_code=202)
async def upload_dataset(project_id: str, request: Request, file: UploadFile = File(...), name: str = Form(""),
                         epoch: str | None = Form(None), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    project_for(db, user, project_id, "editor")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in pcio.SUPPORTED:
        raise HTTPException(400, f"unsupported file type {suffix!r}; supported: {', '.join(pcio.SUPPORTED)}")
    fd, tmp = tempfile.mkstemp(suffix=suffix)  # never use the client's file name as a path
    with os.fdopen(fd, "wb") as f:
        while chunk := await file.read(8 * 1024 * 1024):
            f.write(chunk)
    try:
        ds_id, job_id = services.ingest_file(request.app.state, user.tenant_id, project_id, name or file.filename or "upload", Path(tmp), epoch)
    except pcio.UnsupportedFormat as exc:
        Path(tmp).unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    return {"datasetId": ds_id, "jobId": job_id}


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return dataset_json(dataset_for(db, user, dataset_id))


@router.delete("/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    ds = dataset_for(db, user, dataset_id, "editor")
    if db.query(Dataset).filter_by(parent_id=dataset_id).count():
        raise HTTPException(409, "dataset has derived datasets; delete those first")
    for model in (Job, Measurement):
        db.query(model).filter_by(dataset_id=dataset_id).update({"dataset_id": None})
    from app.db import Report

    db.query(Report).filter_by(dataset_id=dataset_id).update({"dataset_id": None})
    db.delete(ds)
    db.commit()
    request.app.state.storage.delete_dataset(dataset_id)
    return Response(status_code=204)


@router.get("/datasets/{dataset_id}/hierarchy")
def get_hierarchy(dataset_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    ds = dataset_for(db, user, dataset_id)
    if ds.status != "ready":
        raise HTTPException(409, f"dataset is {ds.status}")
    path = request.app.state.storage.octree_dir(dataset_id) / "hierarchy.json"
    return FileResponse(path, media_type="application/json")


@router.get("/datasets/{dataset_id}/nodes/{node}.bin")
def get_node(dataset_id: str, node: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    dataset_for(db, user, dataset_id)
    try:
        path = request.app.state.storage.node_path(dataset_id, node)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not path.exists():
        raise HTTPException(404, "node not found")
    # Tiles are immutable per dataset version: cache forever (CloudFront in AWS).
    return FileResponse(path, media_type="application/octet-stream",
                        headers={"Cache-Control": "private, max-age=31536000, immutable"})


@router.get("/jobs/{job_id}")
def get_job(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    job = db.get(Job, job_id)
    if job is None or job.tenant_id != user.tenant_id:
        raise HTTPException(404, "job not found")
    return {"id": job.id, "kind": job.kind, "status": job.status, "progress": job.progress, "error": job.error,
            "result": job.result, "datasetId": job.dataset_id}


# ------------------------------------------------------------------ measurements
class MeasureRequest(BaseModel):
    points: list[list[float]] = Field(..., min_length=1, description="[[E, N, H], ...] metres")
    kind: str = Field("distance", pattern="^(distance|point|polyline|area)$")


def compute_measurement(kind: str, pts: list[list[float]]) -> dict:
    if any(len(p) != 3 for p in pts):
        raise HTTPException(422, "each point must be [E, N, H]")
    if kind == "distance":
        if len(pts) != 2:
            raise HTTPException(422, "distance needs exactly 2 points")
        return measure(pts[0], pts[1]).to_dict()
    if kind == "polyline":
        return {"length3d": polyline_length(pts), "length2d": polyline_length([[p[0], p[1], 0.0] for p in pts])}
    if kind == "area":
        return {"area": polygon_area(pts), "perimeter2d": polyline_length([[p[0], p[1], 0.0] for p in pts + [pts[0]]])}
    return {"E": pts[0][0], "N": pts[0][1], "H": pts[0][2], "X": pts[0][1], "Y": pts[0][0]}


@router.post("/measure")
def measure_endpoint(req: MeasureRequest, _: User = Depends(current_user)) -> dict:
    """Server-side twin of the browser math (cross-check)."""
    return compute_measurement(req.kind, req.points)


class SaveMeasurement(MeasureRequest):
    label: str = ""
    datasetId: str | None = None


@router.post("/projects/{project_id}/measurements", status_code=201)
def save_measurement(project_id: str, req: SaveMeasurement, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    project_for(db, user, project_id, "editor")
    if req.datasetId:
        dataset_for(db, user, req.datasetId)
    m = Measurement(tenant_id=user.tenant_id, project_id=project_id, dataset_id=req.datasetId, kind=req.kind,
                    label=req.label, points=req.points, result=compute_measurement(req.kind, req.points), created_by=user.id)
    db.add(m)
    db.commit()
    return {"id": m.id, "kind": m.kind, "label": m.label, "points": m.points, "result": m.result}


@router.get("/projects/{project_id}/measurements")
def list_measurements(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    project_for(db, user, project_id)
    rows = db.query(Measurement).filter_by(project_id=project_id, tenant_id=user.tenant_id).order_by(Measurement.created_at).all()
    return [{"id": m.id, "kind": m.kind, "label": m.label, "points": m.points, "result": m.result} for m in rows]


@router.delete("/projects/{project_id}/measurements/{measurement_id}", status_code=204)
def delete_measurement(project_id: str, measurement_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    project_for(db, user, project_id, "editor")
    m = db.get(Measurement, measurement_id)
    if m is None or m.tenant_id != user.tenant_id or m.project_id != project_id:
        raise HTTPException(404, "measurement not found")
    db.delete(m)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ CRS
class TransformRequest(BaseModel):
    direction: str = Field(..., pattern="^(geographic_to_plane|plane_to_geographic)$")
    points: list[list[float]] = Field(..., min_length=1, max_length=100_000)
    heightType: str = Field("ellipsoidal", pattern="^(ellipsoidal|orthometric)$")
    geoid: crs.GeoidModel = crs.GeoidModel.JPGEO2024


@router.post("/crs/transform")
def transform(req: TransformRequest, _: User = Depends(current_user)) -> dict:
    """geographic_to_plane: [lat, lon, h_or_H] -> {X north, Y east, H orthometric, N geoid}.
    plane_to_geographic: [X north, Y east, H orthometric] -> {lat, lon, h ellipsoidal, H, N}."""
    import numpy as np

    a = np.asarray(req.points, dtype=np.float64)
    if a.ndim != 2 or a.shape[1] not in (2, 3):
        raise HTTPException(422, "points must be [[a, b, height?], ...]")
    height = a[:, 2] if a.shape[1] == 3 else np.zeros(len(a))
    try:
        if req.direction == "geographic_to_plane":
            lat, lon = a[:, 0], a[:, 1]
            X, Y = crs.geographic_to_plane(lat, lon)
            N, info = crs.geoid_undulation(lat, lon, req.geoid)
            H = height - N if req.heightType == "ellipsoidal" else height
            rows = [{"X": float(x), "Y": float(y), "H": float(hh), "N": float(n)} for x, y, hh, n in zip(X, Y, H, N)]
        else:
            lat, lon = crs.plane_to_geographic(a[:, 0], a[:, 1])
            N, info = crs.geoid_undulation(lat, lon, req.geoid)
            H = height if req.heightType == "orthometric" else height - N
            rows = [{"lat": float(la), "lon": float(lo), "h": float(hh + n), "H": float(hh), "N": float(n)}
                    for la, lo, hh, n in zip(lat, lon, H, N)]
    except crs.OutsideGeoidCoverage as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"crs": "EPSG:6677 (X north, Y east)", "geoid": info.to_dict(), "points": rows}
