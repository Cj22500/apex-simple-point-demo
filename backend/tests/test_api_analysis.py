"""API: clean, profile (+DXF), volume, DEM, change, as-built, SIMA/DXF interop, reports."""
import io

import ezdxf
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core import sima
from app.main import create_app
from app.synthetic import site


@pytest.fixture(scope="module")
def ctx(tmp_path_factory):
    app = create_app(data_dir=tmp_path_factory.mktemp("spl2"), seed=True, seed_density=4.0, sync_jobs=True)
    with TestClient(app) as c:
        tok = c.post("/api/auth/dev-token").json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        pid = app.state.seed["project"]
        ds = c.get(f"/api/projects/{pid}/datasets", headers=h).json()
        yield c, h, pid, {d["epoch"]: d["id"] for d in ds}


def L(x, y):  # local -> absolute [E, N]
    return [site.SITE_E0 + x, site.SITE_N0 + y]


def test_clean_creates_child_dataset(ctx):
    c, h, pid, ids = ctx
    r = c.post(f"/api/datasets/{ids['A']}/clean", json={}, headers=h).json()
    job = c.get(f"/api/jobs/{r['jobId']}", headers=h).json()
    assert job["status"] == "done", job
    d = c.get(f"/api/datasets/{r['datasetId']}", headers=h).json()
    parent = c.get(f"/api/datasets/{ids['A']}", headers=h).json()
    rep = job["result"]["report"]
    assert d["parentId"] == ids["A"] and d["pointCount"] == parent["pointCount"] - rep["removed"]
    assert rep["removed"] > 0


def test_profile_and_dxf(ctx):
    c, h, _, ids = ctx
    body = {"a": L(125, 45), "b": L(165, 45), "halfWidth": 1.0, "binSize": 1.0}
    r = c.post(f"/api/datasets/{ids['A']}/profile", json=body, headers=h).json()
    assert r["length"] == pytest.approx(40.0) and r["pointCount"] > 50
    g = np.array(r["ground"])
    assert np.polyfit(g[:, 0], g[:, 1], 1)[0] == pytest.approx(0.05, abs=0.002)
    d = c.post(f"/api/datasets/{ids['A']}/profile.dxf", json=body, headers=h)
    doc = ezdxf.read(io.StringIO(d.content.decode()))
    assert len(doc.modelspace().query("LWPOLYLINE[layer=='PROFILE']")) == 1


def test_volume_endpoint_and_report(ctx):
    c, h, pid, ids = ctx
    sp = site.STOCKPILE
    t = np.linspace(0, 2 * np.pi, 64, endpoint=False)
    poly = [L(sp["x"] + 10 * np.cos(a), sp["y"] + 10 * np.sin(a)) for a in t]
    r = c.post(f"/api/datasets/{ids['A']}/volume", json={"polygon": poly, "reference": 3.0, "method": "tin"}, headers=h).json()
    assert r["cut_m3"] == pytest.approx(site.ANALYTIC["stockpile_volume_epochA_m3"], rel=0.05)  # density 4: coarse
    reps = c.get(f"/api/projects/{pid}/reports?kind=volume", headers=h).json()
    assert reps[0]["id"] == r["reportId"]
    tif = c.post(f"/api/datasets/{ids['A']}/dem.tif", json={"polygon": poly, "reference": 3.0, "cellSize": 1.0}, headers=h)
    assert tif.status_code == 200 and tif.content[:2] in (b"II", b"MM")
    bad = c.post(f"/api/datasets/{ids['A']}/volume", json={"polygon": [L(0, 0), L(0.1, 0), L(0, 0.1)], "reference": 0}, headers=h)
    assert bad.status_code == 422


def test_change_detection_job(ctx):
    c, h, _, ids = ctx
    r = c.post("/api/change", json={"datasetA": ids["A"], "datasetB": ids["B"]}, headers=h).json()
    job = c.get(f"/api/jobs/{r['jobId']}", headers=h).json()
    assert job["status"] == "done", job
    hier = c.get(f"/api/datasets/{r['datasetId']}/hierarchy", headers=h).json()
    assert hier["attributes"]["extras"] == ["dz"]
    assert job["result"]["report"]["min_m"] < -0.03  # settlement bowl / stockpile removal visible


def test_asbuilt_job(ctx):
    c, h, pid, ids = ctx
    design = c.get(f"/api/projects/{pid}/design", headers=h).json()
    assert len(design["triangles"]) == 18
    r = c.post(f"/api/datasets/{ids['A']}/asbuilt", headers=h).json()
    job = c.get(f"/api/jobs/{r['jobId']}", headers=h).json()
    assert job["status"] == "done", job
    rep = job["result"]["report"]
    assert rep["flat"]["points"] > 0 and rep["slope"]["points"] > 0 and "density" in rep
    assert rep["pass"] is False  # raw scan (outliers + over-dig) must not pass
    dxf_bytes = c.get(f"/api/projects/{pid}/design.dxf", headers=h).content
    up = c.post(f"/api/projects/{pid}/design", headers=h, files={"file": ("d.dxf", dxf_bytes)}).json()
    assert up["triangles"] == 18


def test_sima_export_import_round_trip(ctx):
    c, h, pid, _ = ctx
    data = c.get(f"/api/projects/{pid}/export.sim", headers=h).content
    f = sima.read_sima(data)
    assert f.encoding == "cp932" and f.points[0].name == "基準点1"
    cp = site.control_points()[0]
    assert f.points[0].X == pytest.approx(cp["N"], abs=1e-4) and f.points[0].Y == pytest.approx(cp["E"], abs=1e-4)
    r = c.post(f"/api/projects/{pid}/import/sima", headers=h, files={"file": ("x.sim", data)}).json()
    assert r["points"] == len(f.points) and not r["warnings"]
    ms = c.get(f"/api/projects/{pid}/measurements", headers=h).json()
    imported = next(m for m in ms if m["label"] == "基準点1")
    assert imported["points"][0][0] == pytest.approx(cp["E"], abs=1e-4)  # back to internal [E, N, H]


def test_dxf_plan_export(ctx):
    c, h, pid, _ = ctx
    c.post(f"/api/projects/{pid}/measurements", headers=h, json={"kind": "distance", "points": [L(130, 45) + [3.5], L(160, 45) + [5.0]]})
    doc = ezdxf.read(io.StringIO(c.get(f"/api/projects/{pid}/export.dxf", headers=h).content.decode()))
    msp = doc.modelspace()
    assert len(msp.query("POINT[layer=='SURVEY_POINTS']")) >= 6
    assert len(msp.query("LINE[layer=='MEASUREMENTS']")) >= 1


def test_delete_dataset_rules(ctx):
    c, h, pid, ids = ctx
    assert c.delete(f"/api/datasets/{ids['A']}", headers=h).status_code == 409  # has derived children
    viewer = {"Authorization": "Bearer " + c.post("/api/auth/dev-token", params={"email": "viewer@example.com"}).json()["token"]}
    child = next(d for d in c.get(f"/api/projects/{pid}/datasets", headers=h).json() if d["parentId"] and d["meta"].get("derivedBy") == "asbuilt")
    assert c.delete(f"/api/datasets/{child['id']}", headers=viewer).status_code == 403
    assert c.delete(f"/api/datasets/{child['id']}", headers=h).status_code == 204
    assert c.get(f"/api/datasets/{child['id']}", headers=h).status_code == 404


def test_export_laz(ctx):
    c, h, _, ids = ctx
    r = c.get(f"/api/datasets/{ids['A']}/export.laz", headers=h)
    assert r.status_code == 200 and r.content[:4] == b"LASF"
