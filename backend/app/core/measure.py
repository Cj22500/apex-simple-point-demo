"""Survey measurements (server-side twin of frontend/src/geo/measure.ts).

Spec: docs/specs/measurement.md. Frame: [E, N, H] metres, float64.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Sequence

Vec3 = Sequence[float]


@dataclass(frozen=True)
class Measurement:
    dE: float
    dN: float
    dH: float
    horizontal: float
    distance3d: float
    slopePercent: float | None
    slopeDegrees: float | None

    def to_dict(self) -> dict:
        return asdict(self)


def measure(a: Vec3, b: Vec3) -> Measurement:
    dE, dN, dH = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    horizontal = math.hypot(dE, dN)
    distance3d = math.hypot(dE, dN, dH)
    if horizontal > 0:
        pct = dH / horizontal * 100.0
        deg = math.degrees(math.atan2(dH, horizontal))
    else:
        pct = deg = None
    return Measurement(dE, dN, dH, horizontal, distance3d, pct, deg)


def polyline_length(points: Sequence[Vec3]) -> float:
    return sum(math.dist(p, q) for p, q in zip(points, points[1:]))


def polygon_area(points: Sequence[Sequence[float]]) -> float:
    """Plan area (shoelace), shifted to the first vertex to keep precision at large coordinates."""
    n = len(points)
    if n < 3:
        return 0.0
    x0, y0 = points[0][0], points[0][1]
    twice = 0.0
    for i in range(n):
        px, py = points[i][0] - x0, points[i][1] - y0
        qx, qy = points[(i + 1) % n][0] - x0, points[(i + 1) % n][1] - y0
        twice += px * qy - qx * py
    return abs(twice) / 2.0
