"""Generate language-neutral golden test vectors in shared/golden/.

Ground truth here is computed with 50-digit decimal arithmetic (Python `decimal`), NOT with the
float64 code under test, so the Python and TypeScript implementations are both checked against an
independent reference.

Internal frame used by all vectors: E (easting, m), N (northing, m), H (height, m).
In JGD2011 plane-rectangular terms: E = Y (東), N = X (北). The axis swap is done only at the
SIMA/DXF/UI boundaries; see docs/specs/measurement.md.

Usage: python scripts/make_golden.py
"""
from __future__ import annotations

import json
import pathlib
from decimal import Decimal as D, getcontext

getcontext().prec = 50
PI = D("3.14159265358979323846264338327950288419716939937510")
OUT = pathlib.Path(__file__).resolve().parents[1] / "shared" / "golden"


def dsqrt(x: D) -> D:
    return x.sqrt()


def datan(x: D) -> D:
    """arctan via argument reduction + Taylor series, 50 digits."""
    if x < 0:
        return -datan(-x)
    if x > 1:
        return PI / 2 - datan(1 / x)
    # reduce: atan(x) = 2 atan(x / (1 + sqrt(1 + x^2)))
    k = 0
    while x > D("0.1"):
        x = x / (1 + dsqrt(1 + x * x))
        k += 1
    term, total, n = x, x, 1
    x2 = x * x
    while True:
        term = -term * x2
        n += 2
        nxt = term / n
        if abs(nxt) < D(10) ** -48:
            break
        total += nxt
    return total * (2 ** k)


def measure(a: list[str], b: list[str]) -> dict:
    A = [D(v) for v in a]
    B = [D(v) for v in b]
    dE, dN, dH = B[0] - A[0], B[1] - A[1], B[2] - A[2]
    h = dsqrt(dE * dE + dN * dN)
    d3 = dsqrt(dE * dE + dN * dN + dH * dH)
    if h == 0:
        slope_pct = slope_deg = None
    else:
        slope_pct = dH / h * 100
        slope_deg = datan(dH / h) * 180 / PI
    f = lambda v: None if v is None else float(v)  # noqa: E731  (float() rounds the 50-digit value once)
    return {
        "a": [float(v) for v in A],
        "b": [float(v) for v in B],
        "expected": {
            "dE": f(dE), "dN": f(dN), "dH": f(dH),
            "horizontal": f(h), "distance3d": f(d3),
            "slopePercent": f(slope_pct), "slopeDegrees": f(slope_deg),
        },
    }


# Tokyo-scale JGD2011 Zone IX coordinates (E = plane Y, N = plane X).
MEASURE_CASES = [
    ("3-4-12 box at Tokyo Station", ["-5995.1852", "-35367.2301", "3.2100"], ["-5992.1852", "-35363.2301", "15.2100"]),
    ("5.000 % ramp (H = 50 m, dH = 2.5 m)", ["-5980.0000", "-35350.0000", "10.0000"], ["-5940.0000", "-35320.0000", "12.5000"]),
    ("downhill -5.000 % ramp", ["-5940.0000", "-35320.0000", "12.5000"], ["-5980.0000", "-35350.0000", "10.0000"]),
    ("vertical (plumb) pair", ["-5990.4321", "-35360.8765", "4.0000"], ["-5990.4321", "-35360.8765", "7.1234"]),
    ("zero-length pair", ["-5990.4321", "-35360.8765", "4.0000"], ["-5990.4321", "-35360.8765", "4.0000"]),
    ("0.1 mm separation at Tokyo scale", ["-5995.1852", "-35367.2301", "3.2100"], ["-5995.1851", "-35367.2301", "3.2100"]),
    ("Shibuya -> diagonal, irrational result", ["-11536.5735", "-36748.5441", "36.9110"], ["-11478.1234", "-36701.9876", "38.4567"]),
    ("long baseline Tokyo -> Shibuya", ["-5995.1852", "-35367.2301", "3.2100"], ["-11536.5735", "-36748.5441", "36.9110"]),
    ("steep 45 degree", ["-5000.0000", "-35000.0000", "0.0000"], ["-4997.0000", "-34996.0000", "5.0000"]),
]

POLYGONS = [
    ("20 x 10 m rectangle at Tokyo scale", [["-5980.0", "-35350.0"], ["-5960.0", "-35350.0"], ["-5960.0", "-35340.0"], ["-5980.0", "-35340.0"]]),
    ("right triangle legs 30 / 40", [["-6000.0", "-35400.0"], ["-5970.0", "-35400.0"], ["-6000.0", "-35360.0"]]),
    ("clockwise L-shape (area must be positive)", [["0", "0"], ["0", "20"], ["10", "20"], ["10", "10"], ["20", "10"], ["20", "0"]]),
]


def polygon_area(pts: list[list[str]]) -> D:
    P = [[D(x), D(y)] for x, y in pts]
    s = D(0)
    for i in range(len(P)):
        x1, y1 = P[i]
        x2, y2 = P[(i + 1) % len(P)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def polyline_length(pts: list[list[str]]) -> D:
    P = [[D(v) for v in p] for p in pts]
    total = D(0)
    for p, q in zip(P, P[1:]):
        total += dsqrt(sum((qi - pi) ** 2 for pi, qi in zip(p, q)))
    return total


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    measurements = {
        "description": "Survey measurement golden vectors. Frame: [E, N, H] metres. Ground truth: 50-digit decimal arithmetic.",
        "tolerance_m": 1e-4,
        "target_m": 1e-6,
        "cases": [{"name": n, **measure(a, b)} for n, a, b in MEASURE_CASES],
        "polygons": [
            {"name": n, "points": [[float(x), float(y)] for x, y in p], "expectedArea": float(polygon_area(p))}
            for n, p in POLYGONS
        ],
        "polylines": [
            {
                "name": "3D polyline along a 5 % ramp and a 3-4-12 riser",
                "points": [[-5980.0, -35350.0, 10.0], [-5940.0, -35320.0, 12.5], [-5937.0, -35316.0, 24.5]],
                "expectedLength": float(polyline_length([["-5980.0", "-35350.0", "10.0"], ["-5940.0", "-35320.0", "12.5"], ["-5937.0", "-35316.0", "24.5"]])),
            }
        ],
    }
    (OUT / "measurements.json").write_text(json.dumps(measurements, indent=2), encoding="utf-8")

    # Analytic volumes (m^3) for the synthetic site and pure-geometry tests.
    R, r, h = D(8), D(2), D(4)
    volumes = {
        "description": "Analytic earthwork volumes used as ground truth (m^3).",
        "pit_prismoid": {
            "comment": "top 20 x 10 m, depth 3 m, 1:0.5 walls -> bottom 17 x 7 m; prismoidal formula h/6 (A1 + 4 Am + A2)",
            "top": [20.0, 10.0], "bottom": [17.0, 7.0], "depth": 3.0,
            "volume": float(D(3) / 6 * (D(200) + 4 * D("18.5") * D("8.5") + D(119))),
        },
        "stockpile_frustum": {"R": 8.0, "r": 2.0, "h": 4.0, "volume": float(PI * h / 3 * (R * R + R * r + r * r))},
        "square_pyramid": {"base": 10.0, "height": 6.0, "volume": float(D(10) * D(10) * D(6) / 3)},
        "half_cut_pyramid_ref_3m": {
            "comment": "Square pyramid base 10, height 6, reference plane at z = 3: fill above ref = volume of top similar pyramid (scale 1/2) = 200/8",
            "cut_above_ref": float(D(200) / 8),
        },
    }
    (OUT / "volumes.json").write_text(json.dumps(volumes, indent=2), encoding="utf-8")
    print("wrote", OUT / "measurements.json", OUT / "volumes.json")


if __name__ == "__main__":
    main()
