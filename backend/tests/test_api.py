"""End-to-end API: seeded demo (small density), auth, tenancy, roles, ingest, tiles, measure, CRS."""
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core import pcio
from app.core.octree import decode_node
from app.core.pointset import PointSet
from app.main import create_app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    app = create_app(data_dir=tmp_path_factory.mktemp("spl"), seed=True, seed_density=1.0, sync_jobs=True)
    with TestClient(app) as c:
        c.ids = app.state.seed
        yield c


def auth(client, email="demo@example.com"):
    tok = client.post("/api/auth/dev-token", params={"email": email}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def test_requires_token(client):
    r1 = client.get("/api/projects")
    assert r1.status_code == 401
    b1 = r1.json()
    assert b1["code"] == "AUTH_INVALID_TOKEN" and isinstance(b1["params"], dict) and b1["detail"]
    r2 = client.get("/api/projects", headers={"Authorization": "Bearer forged.sig"})
    assert r2.status_code == 401
    assert r2.json()["code"] == "AUTH_INVALID_TOKEN"


def test_seeded_project_and_datasets(client):
    h = auth(client)
    projects = client.get("/api/projects", headers=h).json()
    assert len(projects) == 1 and projects[0]["role"] == "owner"
    ds = client.get(f"/api/projects/{projects[0]['id']}/datasets", headers=h).json()
    assert [d["epoch"] for d in ds] == ["A", "B"]
    assert all(d["status"] == "ready" and d["pointCount"] > 20_000 for d in ds)
    assert ds[0]["meta"]["truth"]["analytic"]["ramp_grade_percent"] == 5.0


def test_hierarchy_and_tiles(client):
    h = auth(client)
    ds = client.get(f"/api/projects/{client.ids['project']}/datasets", headers=h).json()[0]
    hier = client.get(f"/api/datasets/{ds['id']}/hierarchy", headers=h).json()
    root = hier["nodes"][0]
    r = client.get(f"/api/datasets/{ds['id']}/nodes/{root['name']}.bin", headers=h)
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    d = decode_node(r.content, root["count"], root["center"], hier["attributes"]["extras"])
    assert d["xyz"][:, 0].min() > -4301 and d["xyz"][:, 1].max() < -38859  # Toyosu, Zone IX
    assert client.get(f"/api/datasets/{ds['id']}/nodes/../../etc.bin", headers=h).status_code in (400, 404)
    bad_node = client.get(f"/api/datasets/{ds['id']}/nodes/rx9.bin", headers=h)
    assert bad_node.status_code == 400
    assert bad_node.json()["code"] == "INVALID_VALUE" and "reason" in bad_node.json()["params"]


def test_missing_hierarchy_returns_404(client):
    h = auth(client)
    ds = client.get(f"/api/projects/{client.ids['project']}/datasets", headers=h).json()[0]
    hier = client.app.state.storage.octree_dir(ds["id"]) / "hierarchy.json"
    bak = hier.with_suffix(".json.bak")
    hier.rename(bak)
    try:
        r = client.get(f"/api/datasets/{ds['id']}/hierarchy", headers=h)
        assert r.status_code == 404
        body = r.json()
        assert body["detail"] == "hierarchy not found"
        assert body["code"] == "HIERARCHY_NOT_FOUND"
        assert body["params"] == {}
    finally:
        bak.rename(hier)


def test_tenant_isolation(client, metric):
    h_out = auth(client, "other@example.com")
    ds = client.get(f"/api/projects/{client.ids['project']}/datasets", headers=auth(client)).json()[0]
    probes = [
        f"/api/projects/{client.ids['project']}/datasets",
        f"/api/datasets/{ds['id']}",
        f"/api/datasets/{ds['id']}/hierarchy",
        f"/api/datasets/{ds['id']}/nodes/r.bin",
        f"/api/projects/{client.ids['project']}/measurements",
    ]
    responses = [client.get(p, headers=h_out) for p in probes]
    codes = [r.status_code for r in responses]
    metric("Multi-tenancy", f"cross-tenant probes answered 404 ({len(probes)} endpoints)", sum(c != 404 for c in codes), 0, "leaks")
    assert codes == [404] * len(probes)
    for r in responses:
        b = r.json()
        assert b["code"] in ("PROJECT_NOT_FOUND", "DATASET_NOT_FOUND") and isinstance(b["params"], dict) and b["detail"]
    assert client.get("/api/projects", headers=h_out).json()[0]["id"] == client.ids["other_project"]


def test_viewer_role_cannot_write(client):
    h_view = auth(client, "viewer@example.com")
    url = f"/api/projects/{client.ids['project']}/measurements"
    body = {"kind": "distance", "points": [[0, 0, 0], [3, 4, 12]]}
    denied = client.post(url, json=body, headers=h_view)
    assert denied.status_code == 403
    assert denied.json()["code"] == "ROLE_REQUIRED" and denied.json()["params"] == {"role": "editor"} and denied.json()["detail"]
    r = client.post(url, json=body, headers=auth(client))
    assert r.status_code == 201 and r.json()["result"]["distance3d"] == 13.0
    assert len(client.get(url, headers=h_view).json()) == 1  # viewer can read


def test_measure_endpoint_matches_golden(client, golden_measurements):
    h = auth(client)
    for c in golden_measurements["cases"]:
        r = client.post("/api/measure", json={"kind": "distance", "points": [c["a"], c["b"]]}, headers=h).json()
        assert abs(r["distance3d"] - c["expected"]["distance3d"]) < 1e-6
        assert r["slopePercent"] == c["expected"]["slopePercent"] or abs(r["slopePercent"] - c["expected"]["slopePercent"]) < 1e-6


def test_crs_endpoint_vs_gsi(client, golden_crs):
    h = auth(client)
    pts = golden_crs["points"]
    body = {"direction": "geographic_to_plane", "points": [[p["lat"], p["lon"], 100.0] for p in pts]}
    r = client.post("/api/crs/transform", json=body, headers=h).json()
    for p, out in zip(pts, r["points"]):
        assert abs(out["X"] - p["X"]) <= 1e-4 and abs(out["Y"] - p["Y"]) <= 1e-4
        if r["geoid"]["model"] == "jpgeo2024":
            assert abs(out["H"] - (100.0 - p["N_jpgeo2024"])) <= 1e-4
    back = client.post("/api/crs/transform", headers=h, json={
        "direction": "plane_to_geographic", "heightType": "orthometric",
        "points": [[o["X"], o["Y"], o["H"]] for o in r["points"]]}).json()
    for p, o in zip(pts, back["points"]):
        assert abs(o["lat"] - p["lat"]) < 1e-9 and abs(o["h"] - 100.0) < 1e-6


def test_upload_laz_and_reject_unknown(client, tmp_path):
    h = auth(client)
    rng = np.random.default_rng(0)
    ps = PointSet(np.column_stack([-4300 + rng.uniform(0, 10, 2000), -39000 + rng.uniform(0, 10, 2000), rng.uniform(0, 2, 2000)]))
    path = pcio.write_points(ps, tmp_path / "up.laz")
    url = f"/api/projects/{client.ids['project']}/datasets"
    r = client.post(url, headers=h, files={"file": ("up.laz", path.read_bytes())}, data={"name": "uploaded"})
    assert r.status_code == 202
    job = client.get(f"/api/jobs/{r.json()['jobId']}", headers=h).json()
    assert job["status"] == "done", job
    assert client.get(f"/api/datasets/{r.json()['datasetId']}", headers=h).json()["pointCount"] == 2000
    bad = client.post(url, headers=h, files={"file": ("x.docx", io.BytesIO(b"nope"))})
    assert bad.status_code == 400
    bad_body = bad.json()
    assert bad_body["code"] == "UNSUPPORTED_FORMAT" and bad_body["params"]["suffix"] == ".docx" and "supported" in bad_body["params"]
    # viewers may not upload
    denied = client.post(url, headers=auth(client, "viewer@example.com"), files={"file": ("up.laz", path.read_bytes())})
    assert denied.status_code == 403
    assert denied.json()["code"] == "ROLE_REQUIRED" and denied.json()["params"] == {"role": "editor"}


def test_s3_storage_raises_clear_error_at_startup(monkeypatch, tmp_path):
    monkeypatch.setenv("SPL_STORAGE", "s3")
    with pytest.raises(NotImplementedError, match="S3 storage adapter not implemented yet; the worker \\(app/worker\\.py\\) is S3-aware"):
        create_app(data_dir=tmp_path, seed=False)


def _clear_db_env(monkeypatch):
    for var in ("SPL_DATABASE_URL", "SPL_DB_HOST", "SPL_DB_PORT", "SPL_DB_USER", "SPL_DB_PASSWORD", "SPL_DB_NAME"):
        monkeypatch.delenv(var, raising=False)


def test_db_url_defaults_to_sqlite(monkeypatch, tmp_path):
    from pathlib import Path

    _clear_db_env(monkeypatch)
    app = create_app(data_dir=tmp_path, seed=False)
    assert app.state.engine.url.drivername == "sqlite"
    assert Path(app.state.engine.url.database) == tmp_path / "spl.sqlite3"


def test_db_url_built_from_spl_db_env(monkeypatch, tmp_path):
    _clear_db_env(monkeypatch)
    seen = {}
    monkeypatch.setattr("app.main.make_session_factory", lambda url: (seen.setdefault("url", url), (object(), object()))[1])
    monkeypatch.setattr("app.main.Base.metadata.create_all", lambda _engine: None)

    monkeypatch.setenv("SPL_DATABASE_URL", "")
    monkeypatch.setenv("SPL_DB_HOST", "rds.example.internal")
    monkeypatch.setenv("SPL_DB_USER", "adm@in")
    monkeypatch.setenv("SPL_DB_PASSWORD", "p@ss:w/o?r#d%")
    monkeypatch.setenv("SPL_DB_NAME", "spl")
    create_app(data_dir=tmp_path, seed=False)
    assert seen["url"] == "postgresql+psycopg://adm%40in:p%40ss%3Aw%2Fo%3Fr%23d%25@rds.example.internal:5432/spl"

    seen.clear()
    monkeypatch.setenv("SPL_DB_PORT", "5433")
    create_app(data_dir=tmp_path, seed=False)
    assert seen["url"] == "postgresql+psycopg://adm%40in:p%40ss%3Aw%2Fo%3Fr%23d%25@rds.example.internal:5433/spl"


@pytest.mark.parametrize("missing", ["SPL_DB_USER", "SPL_DB_PASSWORD", "SPL_DB_NAME"])
def test_db_url_missing_required_var_raises(monkeypatch, tmp_path, missing):
    _clear_db_env(monkeypatch)
    monkeypatch.setenv("SPL_DB_HOST", "rds.example.internal")
    monkeypatch.setenv("SPL_DB_USER", "spl")
    monkeypatch.setenv("SPL_DB_PASSWORD", "secret")
    monkeypatch.setenv("SPL_DB_NAME", "spl")
    monkeypatch.delenv(missing)
    with pytest.raises(ValueError, match=missing):
        create_app(data_dir=tmp_path, seed=False)


@pytest.mark.parametrize("bad_port", ["notaport", "0", "65536"])
def test_db_url_invalid_port_raises(monkeypatch, tmp_path, bad_port):
    _clear_db_env(monkeypatch)
    monkeypatch.setenv("SPL_DB_HOST", "rds.example.internal")
    monkeypatch.setenv("SPL_DB_USER", "spl")
    monkeypatch.setenv("SPL_DB_PASSWORD", "secret")
    monkeypatch.setenv("SPL_DB_NAME", "spl")
    monkeypatch.setenv("SPL_DB_PORT", bad_port)
    with pytest.raises(ValueError, match="SPL_DB_PORT"):
        create_app(data_dir=tmp_path, seed=False)
