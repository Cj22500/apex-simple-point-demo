# AI agent work log: Simple-Point Lite

How this project was built: a human engineer directing Claude Code (Anthropic) as the main implementation agent. Each feature follows **spec → measurable acceptance criteria → implementation → independent verification → review**. This log is written during the work, not afterwards. It records what the agent got wrong as well as what it got right.

- Specs with acceptance criteria: [`docs/specs/`](docs/specs/)
- Measured results: [`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md) (regenerate with `scripts/verify.ps1`)
- Review checklist applied to every phase: [`docs/REVIEW_CHECKLIST.md`](docs/REVIEW_CHECKLIST.md)

## Working rules
1. **Ground truth must be independent of the code under test.** Analytic geometry, 50-digit `decimal` arithmetic, or official GSI (国土地理院) calculators. Never "the function's own output from yesterday".
2. **Tolerances are written in the spec before the code**, and come from primary sources (MLIT, GSI) where a standard exists.
3. **The same golden vectors are used by Python and TypeScript** (`shared/golden/`), so the two implementations can't drift.
4. When the agent proposes a number from memory (a tolerance, a spec field), it is either verified against a primary source or marked as unverified.

---

## Phase 0: setup, environment, specs (2026-11-12)

### Environment check
- Python 3.14.5: confirmed binary wheels exist for every dependency, including the risky ones (`lazrs`, `pyproj`, `pye57`, `rasterio`, `pycolmap`). No need to fall back to 3.12.
- Node 24.15, TypeScript 7, Vite 8, Vitest 5, Three.js 0.187.
- Note: `npm` fails inside Git Bash on this machine (fnm shim without env). All Node commands run through PowerShell.

### Finding 1: Japan's geoid changed (important for any height output)
- **What happened:** The plan said "geoid = GSIGEO2011". While checking sources, the agent found that GSI switched Japan's height reference to **JPGEO2024** on **2025-04-01**.
- **Verified:** The PROJ CDN has both grids (`jp_gsi_jpgeo2024.tif`, `jp_gsi_gsigeo2011.tif`). At 7 Kanto points, PROJ + JPGEO2024 agrees with the GSI web calculator within **0.05 mm**. GSIGEO2011 differs from JPGEO2024 by **8–11 cm** in the Tokyo area.
- **Decision:** JPGEO2024 is the default; GSIGEO2011 is kept for legacy deliverables. The spec was updated (`docs/specs/crs-geoid.md`).
- **Why it matters:** a tool still on the 2011 model reports heights ~10 cm off in Tokyo, which is far outside any construction tolerance.

### Finding 2: authoritative reference values, not self-consistency
- GSI's calculators have JSON endpoints (`bl2xy.pl`, `geoidcalc.pl`). The agent fetched reference values for 7 points (Tokyo Station, Shibuya/Jingumae, Tsukuba, Yokohama, Chiba, Utsunomiya, the Zone IX origin) into `shared/golden/crs.json`, with source URLs.
- The GSI server rate-limited 4 of 7 geoid requests (`サーバが混み合っております`). The agent retried with 4 s spacing instead of hammering the service.

### Finding 3: MLIT as-built tolerances come from the PDF, not from memory
- The agent's first draft of the as-built spec recalled tolerances from memory. They were not trusted.
- A web-fetch sub-agent could not read the MLIT PDFs (compressed streams). It reported this honestly and **refused to fill in numbers from memory**.
- The PDFs were extracted locally with `pypdf`. Verified values for excavation (掘削工, 面管理): flat areas mean **±50 mm**, individual **±150 mm**; slopes **±70 / ±160 mm**; density **≥ 1 pt/m²**; ±5 cm crest/toe exclusion (Kinki Regional Bureau standard, p.2), and measurement accuracy ±50 mm with 1 m evaluation grids (MLIT 2025 guideline, p.9). Cited in `docs/specs/asbuilt.md`.

### Open question recorded
- SIMA: the brief mentions `D01` records. The sources available document `D00 / B01 / D99` for parcel blocks, and the official JSIMA booklet isn't freely available. The parser handles any `Dxx` generically. **To confirm with APEX.**

### Deliverables
Specs (`measurement`, `crs-geoid`, `earthwork-volume`, `asbuilt`, `sima-dxf`), review checklist, PR template, GitHub Actions CI, golden vectors (`scripts/make_golden.py` computes them with 50-digit decimals), `scripts/verify.py` (runs all suites and writes the report with measured errors).

---

## Phase 1: geo math core (2026-11-12)

### Spec → acceptance criteria
`docs/specs/measurement.md` (≤ 0.1 mm, target 1 µm; null grade for vertical pairs; float32 failure demonstrated) and `docs/specs/crs-geoid.md` (≤ 0.1 mm vs GSI; X = north).

### Implementation
- `frontend/src/geo/measure.ts` + `backend/app/core/measure.py`: same formulas, float64. Polygon area shifts to the first vertex before the shoelace (raw products at Tokyo scale are ~1e9 m² and would lose sub-mm² precision).
- `frontend/src/geo/precision.ts`: float64 origin + float32 offsets, plus a deliberately naive float32 path for the comparison test.
- `backend/app/core/crs.py`: pyproj with authority axis order (lat, lon) → (X north, Y east); geoid via a PROJ `vgridshift` pipeline; constant-N fallback that is **always flagged** `approximate: true`; out-of-coverage raises.
- `backend/app/core/align.py`: Umeyama similarity transform (for SfM → RTK georeferencing).

### What verification caught
1. **Test design error (agent):** the "naive float32 fails" test used a 0.1 mm pair. In float32, the two points collapse onto the *same* value, so the error is *exactly* 0.1000 mm, right on the ≤ 0.1 mm boundary, and the assertion `> 1e-4` failed. Fixed by asserting the collapse explicitly (distance = 0) and testing a 0.3 mm pair, where only 0 or 0.488 mm are representable.
2. **Over-claim (agent):** the agent first claimed the offset method is accurate to 1e-7 m. The measured residual was **1.36e-7 m** (float32 rounding of a 33 m offset). The bound was corrected to 1 µm, still 100× inside the tolerance, and the reasoning (ulp of the offset) is written in the test.
3. **Edit error (agent):** an edit inserted the metric call inside a loop with the wrong indentation, and pytest collection failed. Caught immediately by running the suite.

### Results (from VERIFICATION_REPORT.md)
| Check | Measured | Tolerance |
|---|---|---|
| Measurements, 9 golden cases (Py and TS) | 1.6e-9 mm | 0.1 mm |
| Zone IX origin → (0, 0) | 3.2e-5 mm | 0.1 mm |
| lat/lon → Zone IX vs GSI (7 pts) | 0.047 mm | 0.1 mm |
| JPGEO2024 geoid vs GSI (7 pts) | 0.045 mm | 0.1 mm |
| Naive float32, 0.3 mm pair | 0.3 mm error | fails as designed |
| Float64 origin + float32 offset | 0.00014 mm | 0.1 mm |

### Review (checklist)
Axis order tested explicitly (`test_axis_order_is_x_north_y_east`); heights named h/N/H; no absolute float32; edge cases (zero-length, vertical, degenerate Umeyama input) covered.

---

## Phase 2: synthetic site, formats, octree, database (2026-11-12)

### Spec → acceptance criteria
- The synthetic site's own truth must be verified (a wrong "ground truth" would make every later test meaningless): closed-form volumes vs numerical integration ≤ 0.01 m³; ramp grade exactly 5 %; surface continuous; noise σ and outlier fraction as specified.
- Octree: every point exactly once; decoded coordinates ≤ 0.05 mm; inner nodes hold one point per grid cell.
- I/O: LAS, LAZ, E57, PLY, PTS, XYZ round-trips ≤ 0.1 mm at Tokyo-scale coordinates.
- Tenancy: other tenants get 404 (not 403) on every resource; viewers cannot write.

### Design decision during implementation
- **Pit walls changed from vertical to 1:0.5 slopes (法面).** A vertical-walled pit can't be represented by a 2.5D TIN or DEM, so the "600 m³" box would never be measurable exactly. The 1:0.5 pit is a realistic excavation, gives a flat area (平場) and slopes (法面) for the as-built check, and has an exact prismoidal volume: **474 m³**. A known over-dig defect (−0.20 m Gaussian, 0.804 m³) is added to the floor so the as-built demo has something to find.

### What verification caught
1. **E57 silently lost 1.95 mm (library default).** `pye57.write_scan_raw` stores cartesian values as float32. At plane coordinates (~39 km) that rounds to ~2 mm. The round-trip test failed at 1.95 mm. Fixed by writing coordinates relative to a float64 origin carried in the E57 scan pose (translation), the same origin + offset strategy as the octree. Now ≤ 0.1 mm. *This is the kind of bug that ships unnoticed without numeric tests: the file opens fine in every viewer.*
2. **Over-tight claim (agent):** defect leakage at the floor edge was asserted < 0.01 mm; measured 0.014 mm. It is irrelevant to the volume truth (the defect is added everywhere), so the bound was relaxed to 0.1 mm with the measured value noted.
3. **Tooling:** Alembic's CLI wrapper fails in Git Bash, and Git Bash temp paths aren't valid for Windows Python. Used `python -m alembic` and `cygpath -m`.

### Results
| Check | Result |
|---|---|
| Pit prismoidal volume vs numeric integration | < 0.01 m³ |
| Stockpile frustum volume vs numeric integration | < 0.01 m³ |
| Octree, 3.0 M points | 267 nodes, 3.9 s; decoded error ≤ 0.05 mm |
| 6 formats round trip | all ≤ 0.1 mm (after the E57 fix) |
| Cross-tenant probes | 5/5 endpoints → 404 |
| Alembic upgrade = models, downgrade clean | pass |

### Review (checklist)
Upload names never used as paths (temp file + id). Node names validated by regex (`r[0-7]*`), dataset ids by `[A-Za-z0-9_-]`. Other tenants' resources return 404, so their existence isn't revealed. Tiles are immutable and cacheable.

---

## Phases 3–4: viewer engine, LOD, picking, measurement UX (2026-11-12)

### Spec → acceptance criteria
- LOD: never exceed the point budget; connected subtree (parents before children); frustum culling; refine near the camera first.
- Python-encoded octree node decodes in TypeScript to the same float64 coordinates (≤ 0.05 mm).
- Picking returns the **exact stored point** (float64 from node centre + float32 offset), never a depth-buffer estimate.
- End-to-end: measuring the 5 % ramp through the real UI gives ≈ 5 % within the 3 mm scan noise.

### Implementation
- `engine/lod.ts`: pure, testable priority-queue selection (screen-space radius); `PointCloudLayer.ts`: streaming, per-node materials sharing uniforms, LRU eviction; `PointCloudEngine.ts`: RTC rendering (Z-up, x = E, y = N, z = H), GPU ID picking (node slot << 20 | `gl_VertexID` in RGBA8), Eye-Dome Lighting pass, adaptive point size.
- Colour modes in one shader: RGB, elevation (Turbo), intensity (p2–p98 + gamma), classification, ΔZ (diverging).
- UI: Distance / Point / Polyline / Area tools; panel shows 3D and horizontal distance, ΔX (north), ΔY (east), ΔH, grade % and angle to 0.1 mm; lat/lon, ellipsoidal h and geoid N via the CRS API; "server cross-check" compares browser and Python results; measurements save to the project (DB).

### What verification caught
1. **Shaders didn't compile (agent):** in three.js r187, GLSL3 `ShaderMaterial` no longer aliases `gl_FragColor`. The HUD showed 0.9 M points "visible" while the screen was black. The console said "no valid shader program"; the program info log pinpointed it. Fixed with explicit `out vec4`. *Lesson: a HUD counter is not proof of rendering; pixel coverage was measured with `readPixels`.*
2. **LOD looked blobby / under-used the budget:** refinement stopped at 0.92 M of 2 M points (threshold too high), and coarse parent points were drawn at their own large spacing. Fixed with Potree-style sizing by the deepest visible descendant and a lower threshold → 2.00 M points, 159 nodes.
3. **Picking appeared 3–4 m off in the automated UI test.** Investigation showed the pick was right, but the test's `project()` used the container size while the canvas hadn't been resized (the ResizeObserver doesn't fire while the page is hidden). Fixed: `project()` uses the canvas size, and the frame loop re-checks the size. After the fix, direct picks land within 1 px.
4. **Test harness lesson:** the browser pane was hidden, so `requestAnimationFrame` was suspended. The engine was stepped manually from JS (`__spl.engine.loop()`), and real `PointerEvent`s were dispatched so the actual UI code path was exercised.

### Results
| Check | Result |
|---|---|
| LOD unit tests (budget, subtree, culling, near-first) | 7/7 |
| TS decode of Python node (257 pts, ±100 m offsets) | ≤ 0.05 mm |
| UI Distance on the ramp, local x 130 → 160 | 30.0324 m, **5.010 %** (truth 5 %, noise 3 mm × √2 over 30 m ≈ ±0.014 %) |
| Picked H vs analytic ramp surface | −1.7 mm, −2.1 mm (σ = 3 mm noise) |

Not yet verified: real-time FPS on a visible GPU window (the pane was hidden during automated checks; FPS figures shown came from manual stepping).

---

## Phases 5–6: analysis pipelines and SIMA/DXF interop (2026-11-12)

### Spec → acceptance criteria
`docs/specs/earthwork-volume.md`, `docs/specs/asbuilt.md`, `docs/specs/sima-dxf.md`, plus: SOR recall ≥ 99 % with ≤ 0.5 % good points removed; change detection recovers the −45 mm bowl ±2 mm with ≤ 5 mm RMSE on the pad and no bias on slopes; profile grade of the 5 % ramp ±0.01 %.

### Implementation
- `core/analysis.py`: SOR (k-NN mean distance), corridor profile (station/offset + quantile ground line), M3C2-lite vertical change (robust local plane fit).
- `core/volume.py`: exact TIN prism integrals (analytic split where a triangle crosses the reference plane), median/mean grid DEM, GeoTIFF export (EPSG:6677).
- `core/asbuilt.py`: deviation from a design TIN, 平場/法面 classification by facet grade, ±5 cm crest/toe exclusion, 1 m density grid, MLIT tolerances.
- `core/sima.py` (CP932, X = north), `core/dxf.py` (plan, profile, design TIN 3DFACE import/export).
- API + UI: section tool with 2D CAD profile (true-scale or exaggerated, ground-snapped measuring, DXF/CSV export, slab clipping in 3D); volume polygon tool; Clean / Change / As-built jobs that create derived datasets; SIMA/DXF/LAZ/GeoTIFF exchange; dataset deletion with lineage protection.

### What verification caught
1. **TIN without breaklines (finding, not a bug):** a dense-grid TIN of the 1:0.5 pit was 0.013 % off, while a TIN of the 8 breakline vertices is exact. Delaunay chooses arbitrary diagonals across hip lines. Tests now cover both cases, and the spec recommends constrained TIN.
2. **SOR parameters:** the customary nσ = 2 (PCL default) found only 95.1 % of injected outliers, because ~6 % lie within 0.5 m of the ground and 76 % of those were missed. nσ = 1 → 99.98 % recall, 0 % false removal. The default changed and the trade-off is documented in code and the report.
3. **Change detection: three real bugs, found by numbers rather than by looking:**
   - A plain RMS reweight let epoch-A outliers bias plane fits by ~1 m. Fixed with a median/MAD-seeded robust fit.
   - In the browser run, ΔZ ranged from **−128 m to +210 m**. Diagnosis: 31,275 of 36,222 large values were on building walls, where the ill-conditioned plane fit of a vertical face extrapolates. Vertical change is undefined there; points with gradient > 3 (~72°) are now "unsupported" (NaN, grey in the viewer). The 63° pit walls are still evaluated.
   - Uncleaned epoch B outliers showed up as "change". The UI now defaults to cleaned epochs.
   Result on cleaned epochs: p1/p99 = −20.5 / +7.8 mm, and the bowl and stockpile removal are clearly visible.
4. **As-built design area was wrong (agent design error):** the first design TIN covered the whole pad, so the stockpile counted as +4 m deviation (mean +43 mm, 19,019 failures). As-built (出来形) is evaluated over the excavation only, so the design was redefined as the pit plus a 5 m apron. The result is now realistic: flat mean −1.6 mm (pass), but 116 points exceed ±150 mm at the −200 mm over-dig, so the verdict is **FAIL**, located by the heatmap. Slope mean +0.1 mm, 0 exceedances.
5. ezdxf returns 3 vertices for triangular 3DFACEs; the design TIN reader handles both forms.

### Results (browser, full 3 M-point epochs)
| Check | Result |
|---|---|
| Clean (SOR) epoch A | 6.2 s total, removed 14,149 points |
| Stockpile volume, raw scan: grid median 0.25 m / TIN | 351.971 m³ (+0.03 %) / 355.322 m³ (+1.0 %, outliers) |
| Stockpile volume, cleaned scan: TIN | **351.949 m³ (+0.026 %)** vs analytic 351.858 m³ |
| Section across the pit | pad 3 m, 1:0.5 walls (measured −1.955 vs −1.994 along the skewed line), floor 0 m, defect visible |
| Change A→B (cleaned) | 15.1 s; settlement bowl and stockpile removal visible; walls unsupported |
| As-built (cleaned A) | FAIL: 116 flat points beyond ±150 mm at the over-dig; slope PASS; density 600/600 |

---

## Phase 7: photo integration and 3D Gaussian Splatting (2026-11-12)

### Spec → acceptance criteria
- Pose from EXIF GPS (lat/lon/ellipsoidal h) + DJI-style XMP (yaw/pitch/roll, intrinsics), through JGD2011 Zone IX + JPGEO2024: camera position ≤ 1 mm, control-point reprojection ≤ 0.5 px vs the true pose.
- Photo view: the image overlay and the 3D projection of the same world point agree on screen.
- 3DGS PLY: INRIA attribute layout, positions ≤ 0.1 mm, colours round-trip.

### Implementation
- `core/photos.py`: pinhole model (OpenCV camera frame, yaw from north, pitch −90 = nadir), z-buffer software renderer, so synthetic photos really show the cloud. EXIF GPS via piexif with sub-mm rationals, XMP packet inserted as an APP1 segment, parser for both.
- Seed: a 12-shot RTK flight (8 nadir, 4 oblique) rendered by a background job. The stored pose is what ingest reads back from the JPEG, never the hidden truth.
- Viewer: frustums, thumbnails, "photos that see the picked point" with a marker at the exact pixel, photo view with opacity slider. TS camera model (`geo/camera.ts`) mirrors the Python one and is unit-tested with the same conventions.
- `core/splat.py`: point cloud → 3DGS PLY (isotropic Gaussians sized by 4th-neighbour distance, SH-DC colour, logit opacity, log scale, unit quaternion), written relative to the viewer's RTC origin. Rendered with Spark in the same scene.

### What verification caught
1. **Gimbal singularity:** OrbitControls with a Z-up camera can't represent a nadir view, and its `update()` would overwrite any pose. Photo mode sets the camera quaternion directly from the rotation rows and suspends the controls; exit restores them.

### Results
| Check | Result |
|---|---|
| Camera position after EXIF + geoid round trip | ≤ 1 mm (test) |
| Control-point reprojection, true vs decoded pose | ≤ 0.5 px (test) |
| Photo overlay vs 3D projection, all 12 photos, 8 control-point sightings (browser) | worst **0.25 px** on screen |
| 12-photo flight rendered at startup | ~6 s |
| 3DGS layer, 400 k Gaussians | loaded and rendered in 2.0 s |

---

## Phases 8–9: offline/WASM, AWS, packaging, final verification (2026-11-12)

### Implementation
- **Offline mode:** browser LAS reader + LAZ via laz-perf (WASM) and a TypeScript port of the octree builder, run in a Web Worker. Verified against laspy-written files and node-for-node against the Python builder (deterministic mode).
- **AWS CDK stack** (`infra/`): S3 raw (lifecycle) → Lambda header check → SQS (+DLQ) → Fargate **Spot** ARM64 workers scaling 0–8 on queue depth; API on Fargate behind ALB + CloudFront (tiles edge-cached); RDS PostgreSQL t4g.micro in isolated subnets; **no NAT gateways**; least-privilege IAM; 14-day logs; AWS Budgets alarm. 10 assertion tests encode these properties; `cdk synth` is clean.
- `app/worker.py`: the SQS → S3 → octree → tiles worker the stack runs, unit-tested with an in-memory S3 double.
- Dockerfiles (API/worker, nginx SPA) and docker-compose with PostgreSQL; `pyproject.toml` made installable (setuptools package discovery).
- README with a 5-minute interview demo script; `docs/ARCHITECTURE.md` with the precision design and a rough AWS cost model.

### What verification caught
1. **Offline open of a 3 M-point LAZ took 33 s.** The TS octree sorted millions of small objects per level. Typed-array keys + index sort brought the build to 2.2 s for 3 M points, and a single reused DataView sped up decoding. Now 23 s total, dominated by laz-perf's point-at-a-time WASM API.
2. **The CDK stack referenced `python -m app.worker`, which didn't exist yet.** The worker was implemented and tested, so the IaC doesn't describe code that isn't there.
3. **Packaging:** without `[tool.setuptools.packages.find]`, `pip install -e .` (used by CI and Docker) fails on flat-layout discovery. Fixed and verified by building a wheel.
4. **IAM test bug (test, not stack):** the first least-privilege assertion matched whole policy documents and flagged the API (raw `PutObject` + tiles read in one document). It was rewritten to check per statement; the API can only `PutObject` to `uploads/*`.
5. **Spec wording vs data:** the volume spec claimed "a finer grid is not worse", but 0.1 m (0.032 %) is slightly worse than 0.25 m (0.020 %): noise starts to outweigh discretisation. The spec was corrected to match the measurement.

### Final state
- `scripts/verify.ps1`: **158 tests pass** (98 pytest, 50 vitest, 10 CDK) + `tsc`; `VERIFICATION_REPORT.md` regenerated: every accuracy check passes, plus 3 informational findings and 1 designed failure (naive float32).
- Browser checks (automated through the real UI): measurement 5.010 % on the 5 % ramp (server and offline layers), section, volume (+0.026 % after cleaning), change detection, as-built FAIL at the known over-dig, photo alignment ≤ 0.25 px, 3DGS layer, offline LAZ.

### Not done / not verified (honest list)
- **Docker images were not built:** Docker isn't installed on the build machine. The Dockerfiles and compose file are written but untested.
- **No AWS deployment** (by design). The API's S3 storage adapter is not implemented; the worker is.
- **Real-time FPS was not measured on a visible GPU window.** The browser pane was hidden during automated checks, and the HUD FPS figures came from manual frame stepping.
- **SfM spike (pycolmap) not done** (stretch). Umeyama georeferencing, its core maths, is implemented and tested.
- EN/日本語 UI label toggle (stretch) not done. The GitHub repo isn't pushed, so the CI workflow hasn't run on GitHub yet.

---

## README screenshots (2026-11-12)
- `scripts/screenshots.py` drives the running dev app in headless Chrome (Playwright with the installed Chrome, no browser download) through **real mouse clicks**: Distance, Section, Volume, Clean, Change, As-built, photo view, 3DGS. So the screenshots double as an end-to-end run on a fresh seed.
- The fresh run reproduced the earlier numbers exactly: ramp 30.0324 m / 5.010 %, stockpile TIN on the cleaned scan 351.949 m³, as-built FAIL with 116 flat points beyond ±150 mm.
- The PNGs were 12 MB (noisy point clouds compress badly); they're stored as quality-85 JPEG instead (2.6 MB).
- The first CI run on GitHub (after the push) passed: backend, frontend and infra jobs.

## Post-build audit fixes (2026-11-13)
- Fixed five minor UI, screenshot, CDK, and config gaps without altering any verified survey math:
  - **As-built UI & Design TIN upload:** Added `<AsBuiltControls />` to `frontend/src/ui/AnalysisPanel.tsx` when the `As-built` tool is active (status of seeded vs. uploaded design via `GET /api/projects/{id}/design`, `Run as-built check`, `.dxf` upload to `POST /api/projects/{id}/design` with inline 400 error display, and `Download design TIN (DXF)` via `/api/projects/{id}/design.dxf`), updated the toolbar hint in `frontend/src/ui/panels.tsx`, excluded `data-tool="asbuilt"` from the crosshair cursor in `frontend/src/styles.css`, and kept `ProcessingControls`'s `"As-built check"` intact.
  - **HUD z-index & as-built table framing:** Layered `.hud` (`z-index: 5`) and `.profile-drawer` (`z-index: 6`) over `.viewer`/`.label-layer` (`z-index: 1`) and `.photo-overlay` (`z-index: 3`) in `frontend/src/styles.css`, and scrolled `.asbuilt-report` instead of `.verdict` into view in `scripts/screenshots.py` so `07-asbuilt-inspection.jpg` shows all rows (`平場 flat`, `法面 slope`, `Density`, `Crest/toe`).
  - **Fresh-seed screenshot verification:** Re-ran `scripts/screenshots.py` on a clean fresh seed (waiting for the background `photos` seed job to finish all 12 photos before launching Chrome) and verified identical numbers: ramp `30.0324 m` at `5.010 %`, stockpile TIN `351.949 m³`, as-built `FAIL` with `116` flat points exceeding `±150 mm`, `0` slope violations, `600/600` density cells. Documented/observed that `PhotoPanel.tsx` still stops polling if opened before all 12 seeded photos finish committing (left untouched to keep edits strictly within plan).
  - **CDK `logGroup` cleanup:** Replaced the 3 deprecated `logRetention` options in `infra/lib/stack.ts` with explicit 14-day `logs.LogGroup` constructs (`UploadNotifierLogs`, `ApiLogs`, `WorkerLogs`, `DESTROY`) and updated `infra/test/stack.test.ts` + snapshot (`cdk synth --quiet` clean).
  - **`SPL_STORAGE=s3` fail-fast guard:** Raised an explicit `NotImplementedError` at API startup in `backend/app/main.py` when `SPL_STORAGE=s3` (`ValueError` on unknown values), added `test_s3_storage_raises_clear_error_at_startup` in `backend/tests/test_api.py`, and noted the deferred API `S3Storage` adapter under `## Known gaps & next steps` in `docs/ARCHITECTURE.md`.
- Verification after final code edits: `scripts/verify.ps1` passed (`pytest`: 99 passed, `vitest`: 50 passed, `tsc --noEmit`: clean, `infra` CDK tests: 10 passed), `npm.cmd run build` (`vite build`) passed, and `cdk synth --quiet` exited 0.

