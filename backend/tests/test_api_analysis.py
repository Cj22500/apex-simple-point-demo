"""API: clean, profile (+DXF), volume, DEM, change, as-built, SIMA/DXF interop, reports."""
import io
import tempfile
from pathlib import Path

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
    en_texts = [e.dxf.text for e in doc.modelspace().query("TEXT[layer=='PROFILE']")]
    assert any("section (" in t for t in en_texts)

    d_ja = c.post(f"/api/datasets/{ids['A']}/profile.dxf?lang=ja", json=body, headers=h)
    doc_ja = ezdxf.read(io.StringIO(d_ja.content.decode()))
    ja_texts = [e.dxf.text for e in doc_ja.modelspace().query("TEXT[layer=='PROFILE']")]
    assert any("縦断図 (" in t for t in ja_texts)


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
    assert bad.json()["code"] == "TOO_FEW_POINTS_IN_POLYGON" and isinstance(bad.json()["params"], dict) and bad.json()["detail"]


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
    assert design["sourceKey"] == "synthetic_design"
    r = c.post(f"/api/datasets/{ids['A']}/asbuilt", headers=h).json()
    job = c.get(f"/api/jobs/{r['jobId']}", headers=h).json()
    assert job["status"] == "done", job
    rep = job["result"]["report"]
    assert rep["flat"]["points"] > 0 and rep["slope"]["points"] > 0 and "density" in rep
    assert rep["pass"] is False  # raw scan (outliers + over-dig) must not pass
    dxf_bytes = c.get(f"/api/projects/{pid}/design.dxf", headers=h).content
    up = c.post(f"/api/projects/{pid}/design", headers=h, files={"file": ("d.dxf", dxf_bytes)}).json()
    assert up["triangles"] == 18
    assert c.get(f"/api/projects/{pid}/design", headers=h).json()["sourceKey"] == "uploaded"


def test_sima_export_import_round_trip(ctx):
    c, h, pid, _ = ctx
    cps = c.get(f"/api/projects/{pid}/control-points", headers=h).json()
    assert cps[0]["name"] == "基準点1"
    assert cps[0]["nameEn"] == "CP-1" and cps[0]["nameJa"] == "基準点1"

    data = c.get(f"/api/projects/{pid}/export.sim", headers=h).content
    f = sima.read_sima(data)
    assert f.encoding == "cp932" and f.points[0].name == "基準点1"
    f_en = sima.read_sima(c.get(f"/api/projects/{pid}/export.sim?lang=en", headers=h).content)
    assert f_en.points[0].name == "CP-1"
    f_ja = sima.read_sima(c.get(f"/api/projects/{pid}/export.sim?lang=ja", headers=h).content)
    assert f_ja.points[0].name == "基準点1"

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
    c.post(f"/api/projects/{pid}/measurements", headers=h, json={"kind": "distance", "points": [L(135, 45) + [3.0], L(135, 45) + [5.0]]})
    doc = ezdxf.read(io.StringIO(c.get(f"/api/projects/{pid}/export.dxf", headers=h).content.decode()))
    msp = doc.modelspace()
    assert len(msp.query("POINT[layer=='SURVEY_POINTS']")) >= 6
    assert len(msp.query("LINE[layer=='MEASUREMENTS']")) >= 1
    assert any(e.dxf.text == "CP-1" for e in msp.query("TEXT[layer=='SURVEY_POINTS']"))
    assert any("vertical" in e.dxf.text for e in msp.query("TEXT[layer=='MEASUREMENTS']"))

    doc_ja = ezdxf.read(io.StringIO(c.get(f"/api/projects/{pid}/export.dxf?lang=ja", headers=h).content.decode()))
    msp_ja = doc_ja.modelspace()
    assert any(e.dxf.text == "基準点1" for e in msp_ja.query("TEXT[layer=='SURVEY_POINTS']"))
    assert any("鉛直" in e.dxf.text for e in msp_ja.query("TEXT[layer=='MEASUREMENTS']"))


def test_delete_dataset_rules(ctx):
    c, h, pid, ids = ctx
    conflict = c.delete(f"/api/datasets/{ids['A']}", headers=h)
    assert conflict.status_code == 409  # has derived children
    assert conflict.json()["code"] == "CANNOT_DELETE_BASE_DATASET" and isinstance(conflict.json()["params"], dict)
    viewer = {"Authorization": "Bearer " + c.post("/api/auth/dev-token", params={"email": "viewer@example.com"}).json()["token"]}
    child = next(d for d in c.get(f"/api/projects/{pid}/datasets", headers=h).json() if d["parentId"] and d["meta"].get("derivedBy") == "asbuilt")
    denied = c.delete(f"/api/datasets/{child['id']}", headers=viewer)
    assert denied.status_code == 403
    assert denied.json()["code"] == "ROLE_REQUIRED" and denied.json()["params"] == {"role": "editor"}
    assert c.delete(f"/api/datasets/{child['id']}", headers=h).status_code == 204
    missing = c.get(f"/api/datasets/{child['id']}", headers=h)
    assert missing.status_code == 404
    assert missing.json()["code"] == "DATASET_NOT_FOUND" and isinstance(missing.json()["params"], dict)


def test_export_laz(ctx):
    c, h, _, ids = ctx
    r = c.get(f"/api/datasets/{ids['A']}/export.laz", headers=h)
    assert r.status_code == 200 and r.content[:4] == b"LASF"


def test_profile_dxf_zero_length_returns_422(ctx):
    c, h, _, ids = ctx
    r = c.post(f"/api/datasets/{ids['A']}/profile.dxf", json={"a": L(125, 45), "b": L(125, 45)}, headers=h)
    assert r.status_code == 422
    assert r.json()["code"] == "INVALID_VALUE" and "reason" in r.json()["params"]


def test_export_laz_cleans_up_temp_dir(ctx, monkeypatch, tmp_path):
    c, h, _, ids = ctx
    created: list[Path] = []
    real_mkdtemp = tempfile.mkdtemp

    def track_mkdtemp():
        d = Path(real_mkdtemp(dir=tmp_path))
        created.append(d)
        return str(d)

    monkeypatch.setattr(tempfile, "mkdtemp", track_mkdtemp)
    r = c.get(f"/api/datasets/{ids['A']}/export.laz", headers=h)
    assert r.status_code == 200 and r.content[:4] == b"LASF"
    assert len(created) == 1 and not created[0].exists()


def test_export_laz_cleans_up_temp_dir_on_write_error(ctx, monkeypatch, tmp_path):
    c, h, _, ids = ctx
    created: list[Path] = []
    real_mkdtemp = tempfile.mkdtemp

    def track_mkdtemp():
        d = Path(real_mkdtemp(dir=tmp_path))
        created.append(d)
        return str(d)

    monkeypatch.setattr(tempfile, "mkdtemp", track_mkdtemp)
    monkeypatch.setattr("app.core.pcio.write_points", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("write failed")))
    with pytest.raises(RuntimeError, match="write failed"):
        c.get(f"/api/datasets/{ids['A']}/export.laz", headers=h)
    assert len(created) == 1 and not created[0].exists()
