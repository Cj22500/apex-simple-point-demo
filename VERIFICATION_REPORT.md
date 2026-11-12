# Verification report

Generated 2026-11-12 11:27 by `scripts/verify.py`. Ground truth is independent of the code under test: analytic geometry, 50-digit decimal arithmetic, or GSI (国土地理院) official calculators. Tolerances come from `docs/specs/`.

## Test suites

| Suite | Result | Summary | Time |
|---|---|---|---|
| Backend (pytest) | pass | 17 passed in 0.85s | 1.7 s |
| Frontend (vitest) | pass | 22 passed (22) | 26.9 s |
| Frontend (tsc) | pass | no type errors | 1.5 s |

## Measured accuracy

### CRS

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| Zone IX origin -> (0, 0) | 3.21151e-05 mm | 0.1 mm | pass |
| lat/lon -> Zone IX vs GSI calculator (7 pts, max \|dX\|,\|dY\|) | 0.047257 mm | 0.1 mm | pass |
| round trip lat/lon -> IX -> lat/lon (1,000 pts) | 3.03183e-06 mm | 0.1 mm | pass |

### Geoid

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| JPGEO2024 N vs GSI calculator (7 pts) | 0.0451721 mm | 0.1 mm | pass |
| GSIGEO2011 N vs published reference (7 pts) | 0.0482662 mm | 0.1 mm | pass |
| FINDING: JPGEO2024 - GSIGEO2011 at Tokyo Station (informational) | 98.9203 mm | 130 mm | info |

### Measurements (Python)

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| max length error over 9 cases | 1.59162e-09 mm | 0.1 mm | pass |

### Measurements (TypeScript)

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| max length error over 9 cases | 1.59162e-09 mm | 0.1 mm | pass |

### Precision

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| NAIVE absolute float32: 0.3 mm pair at Tokyo scale (expected FAIL) | 0.3 mm | 0.1 mm | fails as designed |
| OURS float64 origin + float32 offset: 0.1 mm pair | 0.000135803 mm | 0.1 mm | pass |
