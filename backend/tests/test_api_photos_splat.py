"""Photo API (seeded RTK flight, upload, back-projection) and 3DGS PLY export."""
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from plyfile import PlyData

from app.core import photos, splat
from app.main import create_app
from app.synthetic import site


@pytest.fixture(scope="module")
def ctx(tmp_path_factory):
    app = create_app(data_dir=tmp_path_factory.mktemp("spl3"), seed=True, seed_density=2.0, sync_jobs=True)
    with TestClient(app) as c:
        tok = c.post("/api/auth/dev-token").json()["token"]
        yield c, {"Authorization": f"Bearer {tok}"}, tok, app.state.seed["project"]


def test_seeded_flight(ctx):
    c, h, tok, pid = ctx
    ph = c.get(f"/api/projects/{pid}/photos", headers=h).json()
    assert len(ph) == 12 and ph[0]["filename"] == "DJI_0001.JPG"
    assert ph[0]["pose"]["geoid_model"] == "jpgeo2024"
    assert len(ph[0]["frustum"]) == 4
    img = c.get(f"/api/photos/{ph[0]['id']}.jpg?token={tok}")  # <img src> style auth
    assert img.status_code == 200 and img.content[:2] == b"\xff\xd8"
    plan = photos.flight_plan(site.SITE_E0, site.SITE_N0, site.PAD_Z + 40.0)[0]
    assert ph[0]["center"] == pytest.approx(list(plan[:3]), abs=1e-3)  # stored pose = recorded EXIF pose


def test_which_photos_see_a_point(ctx):
    c, h, _, pid = ctx
    cp = site.control_points()[0]
    r = c.post(f"/api/projects/{pid}/photos/see", headers=h, json={"point": [cp["E"], cp["N"], cp["H"]]}).json()
    assert r and all(0 <= x["u"] < 1200 and 0 <= x["v"] < 900 for x in r)
    assert r == sorted(r, key=lambda x: x["distance"])


def test_upload_photo_with_exif(ctx):
    c, h, _, pid = ctx
    pose = photos.pose_from_plane(site.SITE_E0 + 50, site.SITE_N0 + 50, 30.0, 10.0, -80.0, 0.0, 400, 300, 60.0)
    jpeg = photos.encode_jpeg(photos.Image.new("RGB", (400, 300)), pose)
    r = c.post(f"/api/projects/{pid}/photos", headers=h, files={"file": ("mine.jpg", jpeg)})
    assert r.status_code == 201 and r.json()["center"] == pytest.approx([pose.E, pose.N, pose.H], abs=1e-3)
    buf = io.BytesIO()
    photos.Image.new("RGB", (8, 8)).save(buf, "JPEG")
    assert c.post(f"/api/projects/{pid}/photos", headers=h, files={"file": ("nogps.jpg", buf.getvalue())}).status_code == 400


def test_splat_ply_layout_and_values(metric):
    rng = np.random.default_rng(4)
    xyz = np.column_stack([site.SITE_E0 + rng.uniform(0, 50, 3000), site.SITE_N0 + rng.uniform(0, 50, 3000), rng.uniform(0, 5, 3000)])
    rgb = rng.integers(0, 255, (3000, 3)).astype(np.uint8)
    origin = (site.SITE_E0 - 1, site.SITE_N0 - 1, 0.0)
    data = splat.pointcloud_to_splat_ply(xyz, rgb, origin=origin)
    v = PlyData.read(io.BytesIO(data))["vertex"].data
    assert list(v.dtype.names) == splat.FIELDS
    pos = np.column_stack([v["x"], v["y"], v["z"]]).astype(np.float64) + np.array(origin)
    err = float(np.max(np.abs(pos - xyz)))
    metric("3DGS export", "splat PLY positions (float32 relative to origin) vs source", err * 1000, 0.1)
    assert err <= 1e-4
    assert np.max(np.abs(splat.splat_colors(data) - rgb)) <= 0.5
    q = np.column_stack([v[f"rot_{i}"] for i in range(4)])
    assert np.allclose(np.linalg.norm(q, axis=1), 1.0)
    assert np.all(np.exp(v["scale_0"]) > 0) and 0 < 1 / (1 + np.exp(-v["opacity"][0])) < 1


def test_splat_endpoint(ctx):
    c, h, _, pid = ctx
    ds = c.get(f"/api/projects/{pid}/datasets", headers=h).json()[0]
    r = c.get(f"/api/datasets/{ds['id']}/splat.ply?ox={site.SITE_E0 - 1}&oy={site.SITE_N0 - 1}&maxPoints=5000", headers=h)
    assert r.status_code == 200 and r.content.startswith(b"ply")
    assert PlyData.read(io.BytesIO(r.content))["vertex"].count == 5000
