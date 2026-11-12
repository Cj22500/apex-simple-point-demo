# Verification report

Generated 2026-11-12 12:09 by `scripts/verify.py`. Ground truth is independent of the code under test: analytic geometry, 50-digit decimal arithmetic, or GSI (国土地理院) official calculators. Tolerances come from `docs/specs/`.

## Test suites

| Suite | Result | Summary | Time |
|---|---|---|---|
| Backend (pytest) | pass | 83 passed in 26.77s | 28.2 s |
| Frontend (vitest) | pass | 38 passed (38) | 2.0 s |
| Frontend (tsc) | pass | no type errors | 1.5 s |

## Measured accuracy

### Cleaning (SOR)

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| default k=16, nσ=1: outliers missed (of 4206) | 0.0237756 % missed | 1 % missed | pass |
| default k=16, nσ=1: good points removed | 0 % | 0.5 % | pass |
| FINDING: PCL-style nσ=2 misses near-surface outliers (informational) | 4.89777 % missed | 100 % missed | info |

### Profile

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| 5 % ramp: fitted grade of the section ground line | 0.00129873 % grade | 0.01 % grade | pass |

### Change detection

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| settlement bowl centre: median ΔZ vs −45 mm | 0.0056085 mm | 2 mm | pass |
| RMSE vs analytic ΔZ field on the pad (σ 3 mm noise) | 3.33566 mm | 5 mm | pass |
| ΔZ p99 \|value\| on unchanged + changed ground (no wall blow-ups) | 31.0905 mm | 100 mm | pass |
| median ΔZ on unchanged 1:0.5 pit walls (bias) | 0.408868 mm | 3 mm | pass |

### Multi-tenancy

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| cross-tenant probes answered 404 (5 endpoints) | 0 leaks | 0 leaks | pass |

### As-built

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| deviation vs known offset field (max error) | 6.02569e-09 mm | 1 mm | pass |
| synthetic site: flat-area mean deviation | 1.59829 mm | 50 mm | pass |

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
| TS decode of Python-encoded node (257 pts, ±100 m offsets) | 0.00379639 mm | 0.05 mm | pass |

### SIMA

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| CP932 write -> read round trip (7 points) | 0 mm | 0.1 mm | pass |

### DXF

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| plan export -> ezdxf re-read: survey points | 0 mm | 0.1 mm | pass |
| profile export -> re-read: station/elevation vertices | 0 mm | 0.1 mm | pass |

### Synthetic site truth

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| pit volume: prismoidal formula vs numeric integration | 0.0002 m³ | 0.01 m³ | pass |
| stockpile volume: frustum formula vs numeric integration | 8.38128e-07 m³ | 0.01 m³ | pass |

### Volume

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| TIN: square pyramid 200 m³ (exact facets) | 0 % | 1e-07 % | pass |
| TIN: crossing-plane split, pyramid above z = 3 m (25 m³) | 0 % | 1e-07 % | pass |
| TIN: 1:0.5 pit from its breakline vertices (474 m³) | 0 % | 1e-07 % | pass |
| TIN: pit on a 0.25 m grid, no breakline constraint | 0.0131857 % | 0.05 % | pass |
| grid 0.5 m on cleaned scan (σ 3 mm): stockpile 351.858 m³ | 0.0847513 % | 0.5 % | pass |
| grid 0.25 m on cleaned scan (σ 3 mm): stockpile 351.858 m³ | 0.0196236 % | 0.5 % | pass |
| grid 0.1 m on cleaned scan (σ 3 mm): stockpile 351.858 m³ | 0.0318651 % | 0.5 % | pass |
| TIN on cleaned scan: stockpile 351.858 m³ | 0.0254004 % | 0.5 % | pass |
| FINDING: raw scan, mean grid 0.1 m (informational) | 0.911425 % | 100 % | info |

### GeoTIFF

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| DEM pixel centre -> world vs DEM grid | 0 mm | 0.1 mm | pass |

### Measurements (TypeScript)

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| max length error over 9 cases | 1.59162e-09 mm | 0.1 mm | pass |

### Precision

| Check | Measured | Tolerance | Status |
|---|---|---|---|
| NAIVE absolute float32: 0.3 mm pair at Tokyo scale (expected FAIL) | 0.3 mm | 0.1 mm | fails as designed |
| OURS float64 origin + float32 offset: 0.1 mm pair | 0.000135803 mm | 0.1 mm | pass |
