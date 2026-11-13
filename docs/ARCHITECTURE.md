# Simple-Point Lite: architecture

## Data flow

```
 LAS/LAZ/E57/PLY/PTS/XYZ ──► ingest (FastAPI job; SQS + Fargate worker in AWS)
                               │ read (laspy/lazrs, pye57, plyfile, text)
                               │ float64 PointSet [E, N, H]
                               ├─► arrays/*.npy (full resolution, memory-mapped for analysis)
                               └─► octree/hierarchy.json + nodes/*.bin (LOD tiles, immutable)
                                                │
 browser ◄── tiles (CDN cached) ────────────────┘
   │  LOD selection (screen-space priority, point budget) → Three.js RTC rendering
   │  GPU ID picking → exact float64 point → measurements (float64, 0.1 mm)
   └─► analysis API: profile, volume, change, as-built, CRS, SIMA/DXF/LAS/GeoTIFF, photos, 3DGS
```

## Precision (the core design decision)

| Where | Representation | Why |
|---|---|---|
| Files | LAS scale 0.0001 (0.1 mm), integer-metre offset | survey resolution; LAS ints are exact |
| Backend | float64 everywhere | ~1e-12 m relative |
| Tiles | float64 node centre (JSON) + **float32 offsets** (≤ ±node size) | float32 ulp at 200 m ≈ 15 µm; at 39 km it would be 3.9 mm |
| GPU | RTC: scene origin = floor(dataset min); objects at (centre − origin) | the GPU only sees small numbers, so no jitter |
| Picking | (node slot, vertex id) from an ID buffer → centre + offset in JS float64 | never a depth-buffer estimate |
| E57 | coordinates relative to a float64 scan pose | pye57 stores float32 (found by tests: 1.95 mm loss) |
| 3DGS | positions relative to the viewer's RTC origin | float32 PLY |

Japanese axis convention: JGD2011 plane coordinates are **X = north, Y = east**. Internally everything is `[E, N, H]`, and the swap happens only at the SIMA/DXF/UI boundaries (tested).

Bilingual localization (`EN | 日本語`): UI labels, seeded/derived dataset names, control points (`CP-1`–`CP-6` vs `基準点1`–`6`), 3D overlays, and structured API/worker errors switch live in `frontend/src/i18n/` without mutating SQLite seed data; SIMA/DXF exports accept `?lang=en|ja` (with CP932 symbol transliteration in `sima.py` and CJK text styles in `dxf.py`), and CSV downloads prepend a UTF-8 BOM.

## Octree format (`spl-octree-1`)

Potree-style grid subsampling: a node keeps one point per cell of a 128³ lattice over its cube, and the rest go to its 8 children; a node with ≤ 20 000 remaining points is a leaf. Every point is stored exactly once. Node binary (little endian, n points, k float32 extras):

```
float32[3n] offsets | float32[n] × k extras (e.g. dz) | uint32[n] source index | uint16[n] intensity | uint8[3n] rgb | uint8[n] class
```

All sections are naturally aligned, so the browser decodes them with typed-array views and no copies. The Python and TypeScript builders produce identical node contents (`tests/octreeBuilder.test.ts`).

## Backend modules

| Module | Responsibility |
|---|---|
| `core/pcio.py` | format I/O |
| `core/octree.py` | LOD tiles |
| `core/measure.py`, `core/crs.py`, `core/align.py` | survey math, JGD2011/JPGEO2024, Umeyama |
| `core/analysis.py` | SOR, profile, change detection |
| `core/volume.py` | TIN / grid cut-fill, DEM, GeoTIFF |
| `core/asbuilt.py` | MLIT 出来形 surface inspection |
| `core/sima.py`, `core/dxf.py` | interop |
| `core/photos.py`, `core/splat.py` | camera model, EXIF/XMP, 3DGS export |
| `errors.py` | structured `CodedHTTPException` error codes & params |
| `db.py`, `auth.py`, `services.py` | multi-tenant schema, roles, jobs |
| `worker.py` | AWS SQS → S3 → octree → tiles worker |

## AWS (infra/, CDK, synthesised and tested, not deployed)

```
browser ─► CloudFront ─┬─► ALB ─► Fargate "api" (ARM64, 0.5 vCPU, autoscale 1–4)
                       └─► S3 tiles (/tiles/*, immutable, edge-cached)
browser ─► S3 raw (presigned PUT) ─► Lambda (header check) ─► SQS (+DLQ)
                                                     └─► Fargate SPOT "worker" (0–8 tasks, step scaling on queue depth)
RDS PostgreSQL t4g.micro (private isolated subnets, encrypted, generated secret)
```

`infra/test/stack.test.ts` asserts the security and cost properties below, so they can't silently regress.

### Cost model (rough, ap-northeast-1)

Assumptions: 50 active projects/month, 20 GB LAZ each (~2 billion points), tiles ≈ 2.2× the LAZ size, 1 TB/month delivered to browsers. Unit prices are approximate list prices. **Verify them in the AWS Pricing Calculator before quoting.**

| Item | Driver | ≈ USD/month |
|---|---|---|
| S3 raw (1 TB; IA after 30 days, Glacier IR after 120) | storage | 15–25 |
| S3 tiles (~2.2 TB) | storage | ~55 |
| CloudFront egress (1 TB, Japan) | data transfer | ~115 (largest variable cost) |
| Fargate API (0.5 vCPU / 1 GB ARM, 24/7) | always on | ~18 |
| Fargate Spot workers (4 vCPU / 16 GB, ~100 h/month) | per job, scale to 0 | ~7 |
| RDS t4g.micro + 20 GB | always on | ~20 |
| ALB | always on | ~20–25 |
| Lambda, SQS, CloudWatch (14-day logs) | usage | < 5 |
| **Total** | | **≈ 255–290** |

Cost decisions encoded in the stack:
- **No NAT gateways** (public subnets + security groups, S3 gateway endpoint): saves ~2 × $45/month.
- **Fargate Spot** for interruptible octree jobs (SQS redelivers on interruption): ~70 % off compute.
- **Graviton/ARM64** images: cheaper per vCPU.
- **Scale to zero** workers; **lifecycle** raw uploads; CloudFront caches tiles (fewer S3 GETs); **log retention 14 days**; **AWS Budgets** alarm at 80 % of a forecast monthly limit.

## Known gaps & next steps

- **API S3 storage adapter:** `SPL_STORAGE=s3` raises at API startup because the API S3 adapter is not implemented yet (`app/worker.py` already supports S3); adding an `S3Storage` adapter to the API is the next step for cloud deployment.
- **Production roadmap:** Cognito JWT auth in `auth.py`, COPC output for interoperability, a WebGPU renderer, and multi-GB datasets with streaming octree builds (PDAL/Entwine-style out-of-core processing).
