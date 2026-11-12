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
