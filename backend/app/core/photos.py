"""Photo integration: pinhole camera model, synthetic drone photo rendering, EXIF/XMP pose I/O.

Conventions (DJI-style metadata):
- EXIF GPS: WGS84/JGD2011 latitude, longitude and *ellipsoidal* height from RTK (GPSAltitude).
- XMP drone-dji: GimbalYawDegree (heading, clockwise from north), GimbalPitchDegree (-90 = nadir),
  GimbalRollDegree, CalibratedFocalLength (px), CalibratedOpticalCenterX/Y (px), RtkFlag.
- Camera frame (OpenCV): x right, y down, z forward. World frame: [E, N, H].
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import asdict, dataclass

import numpy as np
import piexif
from PIL import Image

from app.core import crs


@dataclass
class CameraPose:
    E: float
    N: float
    H: float  # orthometric
    yaw: float  # deg, clockwise from north
    pitch: float  # deg, -90 = looking straight down
    roll: float  # deg
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    lat: float | None = None
    lon: float | None = None
    h: float | None = None  # ellipsoidal
    geoid_model: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def center(self) -> np.ndarray:
        return np.array([self.E, self.N, self.H])

    def rotation(self) -> np.ndarray:
        """World (E, N, H) -> camera (x right, y down, z forward) rotation matrix."""
        yaw, pitch, roll = (math.radians(a) for a in (self.yaw, self.pitch, self.roll))
        heading = np.array([math.sin(yaw), math.cos(yaw), 0.0])
        right0 = np.array([math.cos(yaw), -math.sin(yaw), 0.0])
        fwd = math.cos(pitch) * heading + math.sin(pitch) * np.array([0.0, 0.0, 1.0])
        up = np.cross(right0, fwd)
        # roll: rotate right/up about the forward axis (positive = clockwise as seen from behind)
        c, s = math.cos(roll), math.sin(roll)
        right = c * right0 - s * up
        up = s * right0 + c * up
        return np.vstack([right, -up, fwd])

    def project(self, pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """World points -> (pixel uv (n, 2), depth (n,)). Depth <= 0 means behind the camera."""
        pc = (np.asarray(pts, dtype=np.float64) - self.center) @ self.rotation().T
        z = pc[:, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            u = self.fx * pc[:, 0] / z + self.cx
            v = self.fy * pc[:, 1] / z + self.cy
        return np.column_stack([u, v]), z

    def frustum_corners(self, depth: float) -> np.ndarray:
        """World positions of the 4 image corners at the given depth (for drawing)."""
        corners = np.array([[0, 0], [self.width, 0], [self.width, self.height], [0, self.height]], dtype=np.float64)
        rays = np.column_stack([(corners[:, 0] - self.cx) / self.fx, (corners[:, 1] - self.cy) / self.fy, np.ones(4)]) * depth
        return self.center + rays @ self.rotation()


def intrinsics(width: int, height: int, hfov_deg: float) -> tuple[float, float, float, float]:
    fx = (width / 2) / math.tan(math.radians(hfov_deg) / 2)
    return fx, fx, width / 2, height / 2


# ------------------------------------------------------------------ synthetic rendering
def render_photo(pose: CameraPose, xyz: np.ndarray, rgb: np.ndarray, splat: int = 3, max_depth: float = 300.0) -> Image.Image:
    """Software-render the point cloud through the pinhole camera with a z-buffer.
    Points are splatted as splat x splat squares; the nearest point wins each pixel."""
    uv, z = pose.project(xyz)
    ok = (z > 0.5) & (z < max_depth) & (uv[:, 0] >= -splat) & (uv[:, 0] < pose.width + splat) & (uv[:, 1] >= -splat) & (uv[:, 1] < pose.height + splat)
    uv, z, col = uv[ok], z[ok], rgb[ok]
    W, H = pose.width, pose.height
    depth = np.full(W * H, np.inf)
    image = np.zeros((W * H, 3), np.uint8)
    order = np.argsort(-z)  # far to near: nearer points overwrite
    uv, z, col = uv[order], z[order], col[order]
    base_u = np.floor(uv[:, 0]).astype(np.int64)
    base_v = np.floor(uv[:, 1]).astype(np.int64)
    half = splat // 2
    for du in range(-half, splat - half):
        for dv in range(-half, splat - half):
            u, v = base_u + du, base_v + dv
            m = (u >= 0) & (u < W) & (v >= 0) & (v < H)
            idx = v[m] * W + u[m]
            zz = z[m]
            # last write wins with fancy indexing; points are sorted far -> near
            closer = zz < depth[idx]
            depth[idx[closer]] = zz[closer]
            image[idx[closer]] = col[m][closer]
    sky = ~np.isfinite(depth)
    image[sky] = (200, 214, 230)
    return Image.fromarray(image.reshape(H, W, 3), "RGB")


# ------------------------------------------------------------------ EXIF / XMP
def _to_dms_rational(value: float) -> tuple:
    v = abs(value)
    d = int(v)
    m = int((v - d) * 60)
    s = (v - d - m / 60) * 3600
    return ((d, 1), (m, 1), (int(round(s * 1_000_000)), 1_000_000))


def _from_dms_rational(dms, ref: bytes | str) -> float:
    d, m, s = (n / den for n, den in dms)
    val = d + m / 60 + s / 3600
    ref = ref.decode() if isinstance(ref, bytes) else ref
    return -val if ref in ("S", "W") else val


def _xmp_packet(pose: CameraPose) -> bytes:
    xmp = f"""<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"
 drone-dji:GimbalYawDegree="{pose.yaw:+.4f}" drone-dji:GimbalPitchDegree="{pose.pitch:+.4f}" drone-dji:GimbalRollDegree="{pose.roll:+.4f}"
 drone-dji:CalibratedFocalLength="{pose.fx:.4f}" drone-dji:CalibratedOpticalCenterX="{pose.cx:.4f}" drone-dji:CalibratedOpticalCenterY="{pose.cy:.4f}"
 drone-dji:RtkFlag="50" drone-dji:AbsoluteAltitude="{pose.h:+.4f}"/>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>"""
    return b"http://ns.adobe.com/xap/1.0/\x00" + xmp.encode("utf-8")


def _insert_app1(jpeg: bytes, payload: bytes) -> bytes:
    """Insert an APP1 segment right after SOI (and after an existing EXIF APP1 if present)."""
    assert jpeg[:2] == b"\xff\xd8"
    pos = 2
    if jpeg[2:4] == b"\xff\xe1":
        pos = 4 + int.from_bytes(jpeg[4:6], "big")
    seg = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
    return jpeg[:pos] + seg + jpeg[pos:]


def encode_jpeg(image: Image.Image, pose: CameraPose, quality: int = 88) -> bytes:
    """JPEG with EXIF GPS (lat/lon/ellipsoidal h) + DJI-style XMP orientation and intrinsics."""
    gps = {
        piexif.GPSIFD.GPSLatitudeRef: "N" if pose.lat >= 0 else "S",
        piexif.GPSIFD.GPSLatitude: _to_dms_rational(pose.lat),
        piexif.GPSIFD.GPSLongitudeRef: "E" if pose.lon >= 0 else "W",
        piexif.GPSIFD.GPSLongitude: _to_dms_rational(pose.lon),
        piexif.GPSIFD.GPSAltitudeRef: 0,
        piexif.GPSIFD.GPSAltitude: (int(round(pose.h * 10000)), 10000),
    }
    exif = {"0th": {piexif.ImageIFD.Make: "SimplePointLite", piexif.ImageIFD.Model: "SyntheticCam"},
            "Exif": {piexif.ExifIFD.PixelXDimension: pose.width, piexif.ExifIFD.PixelYDimension: pose.height},
            "GPS": gps}
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=quality, exif=piexif.dump(exif))
    return _insert_app1(buf.getvalue(), _xmp_packet(pose))


_XMP_FIELDS = ("GimbalYawDegree", "GimbalPitchDegree", "GimbalRollDegree", "CalibratedFocalLength",
               "CalibratedOpticalCenterX", "CalibratedOpticalCenterY")


def read_pose(jpeg: bytes, geoid: crs.GeoidModel = crs.GeoidModel.JPGEO2024, default_hfov: float = 73.7) -> CameraPose:
    """Pose from EXIF GPS + DJI XMP. Missing orientation defaults to nadir; missing intrinsics to default_hfov."""
    exif = piexif.load(jpeg)
    g = exif.get("GPS", {})
    if piexif.GPSIFD.GPSLatitude not in g:
        raise ValueError("photo has no GPS position")
    lat = _from_dms_rational(g[piexif.GPSIFD.GPSLatitude], g.get(piexif.GPSIFD.GPSLatitudeRef, b"N"))
    lon = _from_dms_rational(g[piexif.GPSIFD.GPSLongitude], g.get(piexif.GPSIFD.GPSLongitudeRef, b"E"))
    num, den = g.get(piexif.GPSIFD.GPSAltitude, (0, 1))
    h = num / den * (-1 if g.get(piexif.GPSIFD.GPSAltitudeRef, 0) == 1 else 1)
    with Image.open(io.BytesIO(jpeg)) as im:
        width, height = im.size
    text = jpeg.decode("latin-1")
    vals: dict[str, float] = {}
    for f in _XMP_FIELDS:
        m = re.search(rf'drone-dji:{f}="([-+0-9.eE]+)"', text)
        if m:
            vals[f] = float(m.group(1))
    fx, fy, cx, cy = intrinsics(width, height, default_hfov)
    if "CalibratedFocalLength" in vals:
        fx = fy = vals["CalibratedFocalLength"]
    cx = vals.get("CalibratedOpticalCenterX", cx)
    cy = vals.get("CalibratedOpticalCenterY", cy)
    X, Y = crs.geographic_to_plane(lat, lon)
    H, info = crs.ellipsoidal_to_orthometric(lat, lon, h, geoid)
    return CameraPose(E=float(Y), N=float(X), H=float(np.asarray(H).ravel()[0]),
                      yaw=vals.get("GimbalYawDegree", 0.0), pitch=vals.get("GimbalPitchDegree", -90.0), roll=vals.get("GimbalRollDegree", 0.0),
                      fx=fx, fy=fy, cx=cx, cy=cy, width=width, height=height, lat=lat, lon=lon, h=h, geoid_model=info.model.value)


def pose_from_plane(E: float, N: float, H: float, yaw: float, pitch: float, roll: float, width: int, height: int,
                    hfov: float, geoid: crs.GeoidModel = crs.GeoidModel.JPGEO2024) -> CameraPose:
    """Ground-truth pose in plane coordinates -> pose with geodetic position (what an RTK drone would record)."""
    lat, lon = crs.plane_to_geographic(N, E)
    lat, lon = float(lat), float(lon)
    h, info = crs.orthometric_to_ellipsoidal(lat, lon, H, geoid)
    fx, fy, cx, cy = intrinsics(width, height, hfov)
    return CameraPose(E, N, H, yaw, pitch, roll, fx, fy, cx, cy, width, height, lat, lon, float(np.asarray(h).ravel()[0]), info.model.value)


def flight_plan(origin_e: float, origin_n: float, altitude_h: float) -> list[tuple[float, float, float, float, float]]:
    """12 shots over the synthetic site: 8 nadir in a grid + 4 oblique looking at the pit/stockpile."""
    shots = []
    for i, x in enumerate((30.0, 70.0, 110.0, 150.0)):
        for y in (35.0, 75.0):
            shots.append((origin_e + x, origin_n + y, altitude_h, 0.0 if i % 2 == 0 else 180.0, -90.0))
    shots += [
        (origin_e + 40.0, origin_n + 5.0, altitude_h - 15, 0.0, -45.0),
        (origin_e + 85.0, origin_n + 95.0, altitude_h - 15, 180.0, -50.0),
        (origin_e + 130.0, origin_n + 45.0, altitude_h - 20, 270.0, -40.0),
        (origin_e + 175.0, origin_n + 110.0, altitude_h - 10, 225.0, -35.0),
    ]
    return shots
