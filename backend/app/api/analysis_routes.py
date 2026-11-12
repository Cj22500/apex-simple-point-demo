"""Analysis endpoints: cleaning, profile, volume, DEM, change detection, as-built."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import services
from app.api.core_routes import dataset_for
from app.auth import current_user, get_db, project_for
from app.core import asbuilt as asbuilt_mod
from app.core import dxf
from app.core.analysis import extract_profile, statistical_outlier_removal, vertical_change
from app.core.pointset import PointSet
from app.core.volume import build_dem, points_in_polygon, volume_grid, volume_tin, write_geotiff
from app.db import Dataset, Report, User

router = APIRouter(prefix="/api")


def _ready(ds: Dataset) -> None:
    if ds.status != "ready":
        raise HTTPException(409, f"dataset is {ds.status}")


def _save_report(db: Session, user: User, ds: Dataset, kind: str, params: dict, result: dict) -> str:
    r = Report(tenant_id=user.tenant_id, project_id=ds.project_id, dataset_id=ds.id, kind=kind, params=params,
               result=result, created_by=user.id)
    db.add(r)
    db.commit()
    return r.id


# ------------------------------------------------------------------ cleaning
class CleanRequest(BaseModel):
    k: int = Field(16, ge=4, le=64)
    nSigma: float = Field(1.0, gt=0, le=5)


@router.post("/datasets/{dataset_id}/clean", status_code=202)
def clean(dataset_id: str, req: CleanRequest, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    ds = dataset_for(db, user, dataset_id, "editor")
    _ready(ds)

    def fn(ps: PointSet, progress):
        res = statistical_outlier_removal(ps.xyz, k=req.k, n_sigma=req.nSigma)
        return ps.subset(res.keep), {"kind": "sor", "k": req.k, "nSigma": req.nSigma, **res.summary()}

    new_id, job_id = services.derive_dataset(request.app.state, ds, f"{ds.name} (cleaned)", "clean", fn,
                                             meta={k: v for k, v in (ds.meta or {}).items() if k in ("truth", "synthetic")})
    return {"datasetId": new_id, "jobId": job_id}


# ------------------------------------------------------------------ profile
class ProfileRequest(BaseModel):
    a: list[float] = Field(..., min_length=2, max_length=3, description="[E, N] start")
    b: list[float] = Field(..., min_length=2, max_length=3, description="[E, N] end")
    halfWidth: float = Field(0.25, gt=0, le=50)
    binSize: float = Field(0.1, gt=0, le=10)
    maxPoints: int = Field(20_000, ge=100, le=200_000)
    groundOnly: bool = True


def _profile(request: Request, ds: Dataset, req: ProfileRequest):
    ps = request.app.state.storage.load_arrays(ds.id)
    cls = ps.classification if req.groundOnly and ps.classification is not None else None
    return extract_profile(np.asarray(ps.xyz), req.a, req.b, req.halfWidth, req.binSize, 0.1, cls)


@router.post("/datasets/{dataset_id}/profile")
def profile(dataset_id: str, req: ProfileRequest, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    ds = dataset_for(db, user, dataset_id)
    _ready(ds)
    try:
        p = _profile(request, ds, req)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    n = len(p.station)
    pick = np.arange(n) if n <= req.maxPoints else np.sort(np.random.default_rng(0).choice(n, req.maxPoints, replace=False))
    return {
        "length": p.length,
        "pointCount": n,
        "points": np.column_stack([p.station[pick], p.offset[pick], p.z[pick]]).round(4).tolist(),
        "ground": np.column_stack([p.ground_station, p.ground_z]).round(4).tolist(),
        "zMin": float(p.z.min()) if n else None,
        "zMax": float(p.z.max()) if n else None,
    }


@router.post("/datasets/{dataset_id}/profile.dxf")
def profile_dxf(dataset_id: str, req: ProfileRequest, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    ds = dataset_for(db, user, dataset_id)
    _ready(ds)
    p = _profile(request, ds, req)
    data = dxf.profile_dxf(p.ground_station, p.ground_z, title=f"{ds.name} section ({p.length:.2f} m)")
    return Response(data, media_type="application/dxf", headers={"Content-Disposition": 'attachment; filename="profile.dxf"'})


# ------------------------------------------------------------------ volume & DEM
class VolumeRequest(BaseModel):
    polygon: list[list[float]] = Field(..., min_length=3, description="[[E, N], ...]")
    reference: float
    method: str = Field("grid", pattern="^(grid|tin)$")
    cellSize: float = Field(0.25, gt=0.01, le=10)
    groundOnly: bool = True


def _region(request: Request, ds: Dataset, polygon, ground_only: bool) -> np.ndarray:
    ps = request.app.state.storage.load_arrays(ds.id)
    poly = np.asarray(polygon, dtype=np.float64)[:, :2]
    xyz = np.asarray(ps.xyz)
    lo, hi = poly.min(axis=0), poly.max(axis=0)
    box = (xyz[:, 0] >= lo[0]) & (xyz[:, 0] <= hi[0]) & (xyz[:, 1] >= lo[1]) & (xyz[:, 1] <= hi[1])
    if ground_only and ps.classification is not None:
        box &= np.asarray(ps.classification) == 2
    sub = xyz[box]
    return sub[points_in_polygon(sub[:, :2], poly)]


@router.post("/datasets/{dataset_id}/volume")
def volume(dataset_id: str, req: VolumeRequest, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    ds = dataset_for(db, user, dataset_id)
    _ready(ds)
    pts = _region(request, ds, req.polygon, req.groundOnly)
    if len(pts) < 3:
        raise HTTPException(422, "fewer than 3 points inside the polygon")
    poly = np.asarray(req.polygon)[:, :2]
    r = volume_tin(pts, poly, req.reference) if req.method == "tin" else volume_grid(pts, poly, req.reference, req.cellSize)
    result = {**r.to_dict(), "points": int(len(pts))}
    result["reportId"] = _save_report(db, user, ds, "volume", req.model_dump(), result)
    return result


@router.post("/datasets/{dataset_id}/dem.tif")
def dem_tif(dataset_id: str, req: VolumeRequest, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    ds = dataset_for(db, user, dataset_id)
    _ready(ds)
    pts = _region(request, ds, req.polygon, req.groundOnly)
    if len(pts) < 3:
        raise HTTPException(422, "fewer than 3 points inside the polygon")
    dem = build_dem(pts, req.cellSize, np.asarray(req.polygon)[:, :2])
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "dem.tif"
        write_geotiff(dem, path)
        data = path.read_bytes()
    return Response(data, media_type="image/tiff", headers={"Content-Disposition": 'attachment; filename="dem_epsg6677.tif"'})


# ------------------------------------------------------------------ change detection
class ChangeRequest(BaseModel):
    datasetA: str
    datasetB: str
    k: int = Field(12, ge=4, le=64)


@router.post("/change", status_code=202)
def change(req: ChangeRequest, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    a = dataset_for(db, user, req.datasetA)
    b = dataset_for(db, user, req.datasetB, "editor")
    _ready(a)
    _ready(b)
    if a.project_id != b.project_id:
        raise HTTPException(422, "datasets belong to different projects")

    def fn(pb: PointSet, pa: PointSet, progress):
        res = vertical_change(pa.xyz, pb.xyz, k=req.k)
        out = PointSet(pb.xyz, pb.intensity, pb.rgb, pb.classification, {"dz": res.dz.astype(np.float32)})  # NaN = unsupported
        return out, {"kind": "change", "reference": a.name, "compared": b.name, **res.stats}

    new_id, job_id = services.derive_dataset(request.app.state, b, f"ΔZ {b.epoch or b.name} vs {a.epoch or a.name}", "change", fn,
                                             meta={"changeOf": [a.id, b.id]}, source=[b, a])
    return {"datasetId": new_id, "jobId": job_id}


# ------------------------------------------------------------------ as-built
def design_path(request: Request, project_id: str) -> Path:
    d = request.app.state.storage.root / "designs"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{project_id}.json"


def load_design(request: Request, db: Session, project_id: str) -> tuple[np.ndarray, np.ndarray, str]:
    p = design_path(request, project_id)
    if p.exists():
        j = json.loads(p.read_text(encoding="utf-8"))
        return np.array(j["vertices"]), np.array(j["triangles"]), j.get("source", "uploaded")
    synthetic = db.query(Dataset).filter_by(project_id=project_id).filter(Dataset.source_format == "synthetic").first()
    if synthetic is None:
        raise HTTPException(404, "no design surface for this project; upload a DXF with 3DFACE entities")
    from app.synthetic import site

    v, t = site.design_tin()
    return v, t, "synthetic design (pad + 1:0.5 pit)"


@router.get("/projects/{project_id}/design")
def get_design(project_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    project_for(db, user, project_id)
    v, t, src = load_design(request, db, project_id)
    return {"source": src, "vertices": v.tolist(), "triangles": t.tolist()}


@router.post("/projects/{project_id}/design")
async def upload_design(project_id: str, request: Request, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    project_for(db, user, project_id, "editor")
    try:
        v, t = dxf.read_design_tin(await file.read())
    except Exception as exc:  # noqa: BLE001  (any parse failure is a client error)
        raise HTTPException(400, f"cannot read design DXF: {exc}") from exc
    design_path(request, project_id).write_text(json.dumps({"vertices": v.tolist(), "triangles": t.tolist(), "source": file.filename}), encoding="utf-8")
    return {"vertices": len(v), "triangles": len(t)}


@router.get("/projects/{project_id}/design.dxf")
def design_dxf(project_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    project_for(db, user, project_id)
    v, t, _ = load_design(request, db, project_id)
    return Response(dxf.design_tin_dxf(v, t), media_type="application/dxf", headers={"Content-Disposition": 'attachment; filename="design_tin.dxf"'})


@router.post("/datasets/{dataset_id}/asbuilt", status_code=202)
def asbuilt(dataset_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    ds = dataset_for(db, user, dataset_id, "editor")
    _ready(ds)
    verts, tris, src = load_design(request, db, ds.project_id)

    def fn(ps: PointSet, progress):
        xyz = np.asarray(ps.xyz)
        lo, hi = verts[:, :2].min(axis=0), verts[:, :2].max(axis=0)
        box = (xyz[:, 0] >= lo[0]) & (xyz[:, 0] <= hi[0]) & (xyz[:, 1] >= lo[1]) & (xyz[:, 1] <= hi[1])
        if ps.classification is not None:
            box &= np.asarray(ps.classification) == 2
        idx = np.nonzero(box)[0]
        r = asbuilt_mod.inspect(xyz[idx], verts, tris)
        keep = idx[r.index]
        out = ps.subset(keep)
        out.extra = {"dz": r.dz.astype(np.float32)}
        return out, {"kind": "asbuilt", "design": src, **r.summary, "cells": r.cells}

    new_id, job_id = services.derive_dataset(request.app.state, ds, f"As-built deviation: {ds.name}", "asbuilt", fn)
    return {"datasetId": new_id, "jobId": job_id}


@router.get("/projects/{project_id}/reports")
def list_reports(project_id: str, kind: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    project_for(db, user, project_id)
    q = db.query(Report).filter_by(project_id=project_id, tenant_id=user.tenant_id)
    if kind:
        q = q.filter_by(kind=kind)
    return [{"id": r.id, "kind": r.kind, "datasetId": r.dataset_id, "params": r.params, "result": r.result,
             "createdAt": r.created_at.isoformat()} for r in q.order_by(Report.created_at.desc()).limit(100)]


@router.get("/datasets/{dataset_id}/export.{ext}")
def export_points(dataset_id: str, ext: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FileResponse:
    from app.core import pcio

    if ext not in ("las", "laz", "ply", "xyz", "pts", "e57"):
        raise HTTPException(400, "unsupported export format")
    ds = dataset_for(db, user, dataset_id)
    _ready(ds)
    ps = request.app.state.storage.load_arrays(ds.id, mmap=False)
    tmp = Path(tempfile.mkdtemp()) / f"{ds.id}.{ext}"
    pcio.write_points(ps, tmp)
    return FileResponse(tmp, filename=f"{ds.name}.{ext}".replace("/", "_"), media_type="application/octet-stream")
