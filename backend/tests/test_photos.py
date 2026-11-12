"""Photo pose: camera conventions, EXIF/XMP round trip through WGS84 + geoid, reprojection, rendering."""
import numpy as np
import pytest

from app.core import photos
from app.synthetic import site

E0, N0 = site.SITE_E0 + 70.0, site.SITE_N0 + 35.0


def nadir(yaw=0.0, pitch=-90.0, roll=0.0, H=43.0):
    return photos.pose_from_plane(E0, N0, H, yaw, pitch, roll, 800, 600, 73.7)


def test_rotation_is_orthonormal_and_nadir_conventions():
    p = nadir()
    R = p.rotation()
    assert np.allclose(R @ R.T, np.eye(3), atol=1e-12) and np.linalg.det(R) == pytest.approx(1.0)
    assert np.allclose(R[2], [0, 0, -1], atol=1e-12)  # looking straight down
    (u_n, v_n), _ = p.project(np.array([[E0, N0 + 10, 3.0]]))[0][0], None
    (u_e, v_e) = p.project(np.array([[E0 + 10, N0, 3.0]]))[0][0]
    assert v_n < p.cy and abs(u_n - p.cx) < 1e-6  # yaw 0: north is up in the image
    assert u_e > p.cx and abs(v_e - p.cy) < 1e-6  # east is right


def test_yaw_and_pitch_conventions():
    p = nadir(yaw=90.0)  # heading east: east is now up in the image
    (u, v) = p.project(np.array([[E0 + 10, N0, 3.0]]))[0][0]
    assert v < p.cy and abs(u - p.cx) < 1e-6
    oblique = nadir(pitch=0.0)  # horizontal, facing north
    assert np.allclose(oblique.rotation()[2], [0, 1, 0], atol=1e-12)
    uv, depth = oblique.project(np.array([[E0, N0 + 50, 43.0]]))
    assert depth[0] == pytest.approx(50.0) and uv[0] == pytest.approx([oblique.cx, oblique.cy])


def test_exif_xmp_round_trip_and_reprojection(metric):
    """Write the pose as an RTK drone would (lat/lon/ellipsoidal h + XMP angles), read it back
    through the CRS + JPGEO2024 pipeline, and reproject the control points with both poses."""
    truth = photos.pose_from_plane(E0, N0, 43.0, 33.3333, -62.5, 1.25, 800, 600, 73.7)
    img = photos.Image.new("RGB", (800, 600), (128, 128, 128))
    back = photos.read_pose(photos.encode_jpeg(img, truth))
    pos_err = float(np.linalg.norm(back.center - truth.center))
    metric("Photos", "camera position after EXIF GPS + geoid round trip", pos_err * 1000, 1.0)
    assert pos_err <= 0.001
    assert (back.yaw, back.pitch, back.roll) == pytest.approx((truth.yaw, truth.pitch, truth.roll), abs=1e-4)
    assert (back.fx, back.cx, back.cy) == pytest.approx((truth.fx, truth.cx, truth.cy), abs=1e-4)
    cps = np.array([[c["E"], c["N"], c["H"]] for c in site.control_points()])
    uv_t, d_t = truth.project(cps)
    uv_b, _ = back.project(cps)
    vis = d_t > 0
    err = float(np.max(np.linalg.norm(uv_t[vis] - uv_b[vis], axis=1)))
    metric("Photos", "control-point reprojection: true pose vs pose read from EXIF/XMP", err, 0.5, "px")
    assert err <= 0.5


def test_render_places_points_at_projected_pixels():
    p = nadir()
    target = np.array([[E0 + 3.0, N0 - 2.0, 3.0]])
    ground = np.column_stack([E0 + np.random.default_rng(0).uniform(-30, 30, (20000, 2)), np.full(20000, 3.0)])
    ground[:, 1] = N0 + np.random.default_rng(1).uniform(-30, 30, 20000)
    xyz = np.vstack([ground, target])
    rgb = np.vstack([np.full((20000, 3), 90, np.uint8), [[255, 0, 0]]])
    img = np.asarray(photos.render_photo(p, xyz, rgb, splat=3))
    (u, v) = p.project(target)[0][0]
    patch = img[int(v) - 1 : int(v) + 2, int(u) - 1 : int(u) + 2]
    assert (patch == [255, 0, 0]).all(axis=-1).any()


def test_photo_without_gps_is_rejected():
    import io

    buf = io.BytesIO()
    photos.Image.new("RGB", (10, 10)).save(buf, "JPEG")
    with pytest.raises(Exception):
        photos.read_pose(buf.getvalue())
