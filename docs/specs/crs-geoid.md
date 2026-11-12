# Spec: Coordinate reference systems and geoid

**Status:** accepted · **Implemented in:** `backend/app/core/crs.py`

## Purpose
Japanese survey deliverables use JGD2011 plane rectangular coordinates and orthometric heights (標高). GNSS/RTK data (drone photos, rovers) gives WGS84/JGD2011 latitude, longitude and **ellipsoidal** height. The platform must convert between them exactly.

## Systems
| Code | Meaning |
|---|---|
| EPSG:4326 | WGS84 geographic (treated as identical to JGD2011 geographic EPSG:6668 at the < 1 cm level; both are ITRF-based. Documented assumption.) |
| EPSG:6668 | JGD2011 geographic |
| EPSG:6677 | JGD2011 / Japan Plane Rectangular CS **IX** (Tokyo, Kanagawa, Chiba, Saitama, Ibaraki, Tochigi, Gunma, Fukushima). Origin 36°00′N, 139°50′E, scale 0.9999. Axis order **X = north, Y = east**. |
| EPSG:6695 | JGD2011 (vertical) height |

## Geoid
- **Default: JPGEO2024** ("ジオイド2024日本とその周辺"), Japan's official geoid since **2025-04-01** (GSI moved the height system to GNSS + geoid). Grid `jp_gsi_jpgeo2024.tif` (CC-BY 4.0, PROJ-data).
- Legacy: **GSIGEO2011** (`jp_gsi_gsigeo2011.tif`) for old deliverables. In Tokyo it differs from JPGEO2024 by about **−8 to −11 cm**. Measured at 7 Kanto points during Phase 0.
- `H = h − N` (orthometric = ellipsoidal − geoid undulation).
- Remote islands need GSI's extra "基準面補正パラメータ" (height reference correction) with JPGEO2024. This is out of scope and refused with an explicit error outside the main islands.
- If the grid file is missing: fall back to a constant N for the project, and **every** response carries `geoid: {"model": "constant", "approximate": true}`, which the UI shows as a warning. Never fail silently.

## Acceptance criteria (checked in `backend/tests/test_crs.py`)
1. Zone IX origin (36°N, 139°50′E) → X = 0, Y = 0 within **0.1 mm**.
2. All 7 GSI reference points in `shared/golden/crs.json`: |ΔX|, |ΔY| ≤ **0.1 mm** (GSI rounds to 0.1 mm).
3. JPGEO2024 N at the same 7 points: |ΔN| ≤ **0.1 mm** against the GSI calculator.
4. GSIGEO2011 N at the 7 PROJ reference points: ≤ 0.1 mm.
5. Round-trip WGS84 → 6677 → WGS84 on 1,000 random points within Zone IX's area: ≤ 0.1 mm (converted to metres on the ground).
6. Axis convention: the API returns `{"X": north, "Y": east}` for plane coordinates; a test fails if they are swapped.

## Phase 0 evidence (2026-11-12)
PROJ 9.8.1 vs GSI: max horizontal difference 0.047 mm; max JPGEO2024 geoid difference 0.05 mm.

## Sources
- GSI height revision Q&A (JPGEO2024, 2025-04-01): https://www.gsi.go.jp/sokuchikijun/hyoko2024rev-QA.html
- GSI plane coordinate calculator (bl2xy) and geoid calculator: see `shared/golden/crs.json`
- PROJ-data GSI grids README: https://cdn.proj.org/jp_gsi_README.txt
