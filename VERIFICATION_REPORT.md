# Verification report

Generated 2026-11-12 11:38 by `scripts/verify.py`. Ground truth is independent of the code under test: analytic geometry, 50-digit decimal arithmetic, or GSI (国土地理院) official calculators. Tolerances come from `docs/specs/`.

## Test suites

| Suite | Result | Summary | Time |
|---|---|---|---|
| Backend (pytest) | pass | 50 passed in 5.28s | 6.5 s |
| Frontend (vitest) | pass | 22 passed (22) | 1.8 s |
| Frontend (tsc) | pass | no type errors | 1.4 s |

## Measured accuracy

### Multi-tenancy

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| cross-tenant probes answered 404 (5 endpoints) | 0 leaks | 0 leaks | pass |

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

### File I/O

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| LAS round trip at Tokyo-scale coordinates (max coord error) | 7.27596e-09 mm | 0.1 mm | pass |
| LAZ round trip at Tokyo-scale coordinates (max coord error) | 7.27596e-09 mm | 0.1 mm | pass |
| E57 round trip at Tokyo-scale coordinates (max coord error) | 0.00761719 mm | 0.1 mm | pass |
| PLY round trip at Tokyo-scale coordinates (max coord error) | 0 mm | 0.1 mm | pass |
| PTS round trip at Tokyo-scale coordinates (max coord error) | 0 mm | 0.1 mm | pass |
| XYZ round trip at Tokyo-scale coordinates (max coord error) | 0 mm | 0.1 mm | pass |

### Measurements (Python)

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| max length error over 9 cases | 1.59162e-09 mm | 0.1 mm | pass |

### Octree

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| decoded float64(center)+float32(offset) vs source, 178,064 pts | 0.00381434 mm | 0.05 mm | pass |

### Synthetic site truth

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| pit volume: prismoidal formula vs numeric integration | 0.0002 m³ | 0.01 m³ | pass |
| stockpile volume: frustum formula vs numeric integration | 8.38128e-07 m³ | 0.01 m³ | pass |

### Measurements (TypeScript)

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| max length error over 9 cases | 1.59162e-09 mm | 0.1 mm | pass |

### Precision

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| NAIVE absolute float32: 0.3 mm pair at Tokyo scale (expected FAIL) | 0.3 mm | 0.1 mm | fails as designed |
| OURS float64 origin + float32 offset: 0.1 mm pair | 0.000135803 mm | 0.1 mm | pass |
