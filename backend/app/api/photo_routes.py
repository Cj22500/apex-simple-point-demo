"""Photos (EXIF/RTK poses, frustums, 'which photos see this point') and 3DGS export."""
from __future__ import annotations

import io
import uuid

import numpy as np
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.core_routes import dataset_for
from app.auth import current_user, get_db, project_for
from app.core import photos, splat
from app.db import Photo, User
from app.errors import (
    ERR_DATASET_NOT_READY,
    ERR_INVALID_VALUE,
    ERR_PHOTO_NO_GPS,
    ERR_PHOTO_NOT_FOUND,
    ERR_POINT_CLOUD_TOO_SMALL,
    CodedHTTPException,
)

router = APIRouter(prefix="/api")


def photo_json(p: Photo) -> dict:
    pose = photos.CameraPose(**p.pose)
    return {"id": p.id, "filename": p.filename, "pose": p.pose,
            "frustum": pose.frustum_corners(6.0).tolist(), "center": pose.center.tolist()}


@router.get("/projects/{project_id}/photos")
def list_photos(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    project_for(db, user, project_id)
    rows = db.query(Photo).filter_by(project_id=project_id, tenant_id=user.tenant_id).order_by(Photo.filename).all()
    return [photo_json(p) for p in rows]


@router.get("/photos/{photo_id}.jpg")
def get_photo(photo_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FileResponse:
    p = db.get(Photo, photo_id)
    if p is None or p.tenant_id != user.tenant_id:
        raise CodedHTTPException(404, ERR_PHOTO_NOT_FOUND, "photo not found")
    project_for(db, user, p.project_id)
    return FileResponse(request.app.state.storage.photo_path(p.id), media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=86400"})


@router.post("/projects/{project_id}/photos", status_code=201)
async def upload_photo(project_id: str, request: Request, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    project_for(db, user, project_id, "editor")
    data = await file.read()
    try:
        pose = photos.read_pose(data)
    except Exception as exc:  # noqa: BLE001  (bad EXIF is a client error)
        raise CodedHTTPException(
            400,
            ERR_PHOTO_NO_GPS,
            f"cannot read photo position: {exc}",
            {"reason": str(exc), "detail": str(exc)},
        ) from exc
    photo_id = uuid.uuid4().hex
    path = request.app.state.storage.photo_path(photo_id)
    path.write_bytes(data)
    p = Photo(id=photo_id, tenant_id=user.tenant_id, project_id=project_id, filename=file.filename or "photo.jpg", pose=pose.to_dict())
    try:
        db.add(p)
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return photo_json(p)


class SeeRequest(BaseModel):
    point: list[float] = Field(..., min_length=3, max_length=3)


@router.post("/projects/{project_id}/photos/see")
def photos_seeing(project_id: str, req: SeeRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    """Photos whose image contains the point (back-projection; occlusion is not tested)."""
    project_for(db, user, project_id)
    out = []
    for p in db.query(Photo).filter_by(project_id=project_id, tenant_id=user.tenant_id).all():
        pose = photos.CameraPose(**p.pose)
        uv, depth = pose.project(np.array([req.point]))
        u, v = uv[0]
        if depth[0] > 0 and 0 <= u < pose.width and 0 <= v < pose.height:
            out.append({"id": p.id, "filename": p.filename, "u": float(u), "v": float(v), "distance": float(depth[0])})
    return sorted(out, key=lambda r: r["distance"])


@router.get("/datasets/{dataset_id}/splat.ply")
def splat_ply(dataset_id: str, request: Request, ox: float, oy: float, oz: float = 0.0,
              maxPoints: int = Query(400_000, ge=5, le=2_000_000),
              user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    """Point cloud -> 3D Gaussian Splatting PLY (INRIA layout), positions relative to (ox, oy, oz)."""
    ds = dataset_for(db, user, dataset_id)
    if ds.status != "ready":
        raise CodedHTTPException(409, ERR_DATASET_NOT_READY, f"dataset is {ds.status}", {"status": ds.status})
    ps = request.app.state.storage.load_arrays(ds.id)
    try:
        data = splat.pointcloud_to_splat_ply(np.asarray(ps.xyz), None if ps.rgb is None else np.asarray(ps.rgb),
                                             origin=(ox, oy, oz), max_points=maxPoints)
    except ValueError as exc:
        code = ERR_POINT_CLOUD_TOO_SMALL if "empty" in str(exc).lower() else ERR_INVALID_VALUE
        raise CodedHTTPException(422, code, str(exc), {"reason": str(exc), "detail": str(exc)}) from exc
    return Response(data, media_type="application/octet-stream", headers={"Content-Disposition": 'attachment; filename="splat.ply"'})


def seed_photos(app_state, tenant_id: str, project_id: str, scan) -> dict:
    """Render the 12-shot synthetic flight from the scan and store them as uploaded photos would be."""
    from app.synthetic import site

    xyz, rgb = scan.points.xyz, scan.points.rgb
    rows: list[Photo] = []
    written: list = []
    try:
        for i, (E, N, H, yaw, pitch) in enumerate(photos.flight_plan(site.SITE_E0, site.SITE_N0, site.PAD_Z + 40.0)):
            pose = photos.pose_from_plane(E, N, H, yaw, pitch, 0.0, 1200, 900, 73.7)
            img = photos.render_photo(pose, xyz, rgb, splat=3)
            jpeg = photos.encode_jpeg(img, pose)
            read_back = photos.read_pose(jpeg)  # store what ingest would see, not the hidden truth
            photo_id = uuid.uuid4().hex
            path = app_state.storage.photo_path(photo_id)
            path.write_bytes(jpeg)
            written.append(path)
            rows.append(Photo(id=photo_id, tenant_id=tenant_id, project_id=project_id,
                              filename=f"DJI_{i + 1:04d}.JPG", pose=read_back.to_dict()))
        with app_state.sessions() as s:
            s.add_all(rows)
            s.commit()
    except Exception:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return {"photos": len(rows)}


__all__ = ["router", "seed_photos", "io"]
