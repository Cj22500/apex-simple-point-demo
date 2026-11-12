"""SIMA and DXF import/export for project survey points and measurements."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.core_routes import compute_measurement
from app.auth import current_user, get_db, project_for
from app.core import dxf, sima
from app.core.measure import measure
from app.db import Dataset, Measurement, Project, User

router = APIRouter(prefix="/api")


def _control_points(db: Session, project: Project) -> list[dict]:
    """Control points (基準点) carried in the metadata of synthetic datasets."""
    for ds in db.query(Dataset).filter_by(project_id=project.id).all():
        cps = (ds.meta or {}).get("truth", {}).get("control_points")
        if cps:
            return [{"number": c["number"], "name": c["name"], "E": c["E"], "N": c["N"], "H": c["H"]} for c in cps]
    return []


@router.get("/projects/{project_id}/control-points")
def control_points(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    return _control_points(db, project_for(db, user, project_id))


@router.get("/projects/{project_id}/export.sim")
def export_sima(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    project = project_for(db, user, project_id)
    f = sima.SimaFile(site_name=project.name)
    for c in _control_points(db, project):
        f.points.append(sima.SimaPoint(c["number"], c["name"], X=c["N"], Y=c["E"], H=c["H"]))
    next_no = max([p.number for p in f.points], default=0) + 1
    rows = db.query(Measurement).filter_by(project_id=project_id, tenant_id=user.tenant_id).order_by(Measurement.created_at).all()
    for m in rows:
        refs = []
        for i, (E, N, H) in enumerate(m.points):
            name = m.label if (m.kind == "point" and m.label) else f"{m.kind[:2].upper()}{next_no}"
            f.points.append(sima.SimaPoint(next_no, name, X=N, Y=E, H=H))
            refs.append((next_no, name))
            next_no += 1
        if m.kind in ("area", "polyline", "distance"):
            f.parcels.append(sima.SimaParcel(len(f.parcels) + 1, m.label or f"{m.kind} {len(f.parcels) + 1}", refs))
    return Response(sima.write_sima(f), media_type="application/octet-stream",
                    headers={"Content-Disposition": 'attachment; filename="survey_points.sim"'})


@router.post("/projects/{project_id}/import/sima")
async def import_sima(project_id: str, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    project_for(db, user, project_id, "editor")
    f = sima.read_sima(await file.read())
    if not f.points:
        raise HTTPException(400, f"no A01 coordinate records found; warnings: {f.warnings[:5]}")
    by_no = {p.number: p for p in f.points}
    created = 0
    for p in f.points:
        pt = [p.Y, p.X, p.H or 0.0]  # SIMA X = north, Y = east -> internal [E, N, H]
        db.add(Measurement(tenant_id=user.tenant_id, project_id=project_id, kind="point", label=p.name, points=[pt],
                           result=compute_measurement("point", [pt]), created_by=user.id))
        created += 1
    for parcel in f.parcels:
        pts = [[by_no[n].Y, by_no[n].X, by_no[n].H or 0.0] for n, _ in parcel.members if n in by_no]
        if len(pts) >= 3:
            db.add(Measurement(tenant_id=user.tenant_id, project_id=project_id, kind="area", label=parcel.name, points=pts,
                               result=compute_measurement("area", pts), created_by=user.id))
            created += 1
    db.commit()
    return {"siteName": f.site_name, "encoding": f.encoding, "points": len(f.points), "parcels": len(f.parcels),
            "created": created, "warnings": f.warnings}


@router.get("/projects/{project_id}/export.dxf")
def export_dxf(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    project = project_for(db, user, project_id)
    points = [{"name": c["name"], "E": c["E"], "N": c["N"], "H": c["H"]} for c in _control_points(db, project)]
    lines, polylines, boundaries = [], [], []
    for m in db.query(Measurement).filter_by(project_id=project_id, tenant_id=user.tenant_id).all():
        if m.kind == "point":
            E, N, H = m.points[0]
            points.append({"name": m.label or "P", "E": E, "N": N, "H": H})
        elif m.kind == "distance":
            r = measure(m.points[0], m.points[1])
            grade = "vertical" if r.slopePercent is None else f"{r.slopePercent:.3f}%"
            lines.append({"a": m.points[0], "b": m.points[1], "label": f"{r.distance3d:.4f} m / {grade}"})
        elif m.kind == "polyline":
            polylines.append({"label": m.label, "points": m.points})
        elif m.kind == "area":
            boundaries.append({"label": m.label, "points": [p[:2] for p in m.points]})
    return Response(dxf.plan_dxf(points, lines, polylines, None, boundaries), media_type="application/dxf",
                    headers={"Content-Disposition": 'attachment; filename="survey_plan.dxf"'})
