# Spec: SIMA and DXF interoperability

**Status:** accepted · **Implemented in:** `backend/app/core/sima.py`, `backend/app/core/dxf.py`

## SIMA (測量データ共通フォーマット, JSIMA)
- Text file `.sim`, comma-separated records, record type in the first field. **Encoding: CP932 (Shift-JIS)**, the encoding used in practice. Reading also accepts UTF-8 (BOM or valid UTF-8) and reports the detected encoding.
- Records handled:
  - `G00` file attributes (version, site name 現場名)
  - `Z00` comment / section label (e.g. `Z00,座標データ,`)
  - `A00` start of coordinate section, `A01` coordinate point: `A01,点番号,点名,X,Y,H,` (**X = north, Y = east**), `A99` end of section
  - `D00` start of a parcel/line block (画地: number, name, point count), `B01` member point reference (点番号, 点名), `D99` end of block
  - Unknown record types are kept as raw lines and reported as warnings, not errors.
- Numbers are written with 4 decimals (0.1 mm). Empty H is allowed (2D point).
- **Open question:** the brief mentions "D01" records. The sources I could check document D00/B01/D99 for parcel blocks. The official JSIMA definition booklet is distributed only in print, so the parser treats any `Dxx` record generically and preserves it. To confirm with APEX.

### Acceptance criteria
1. Write → read round-trip: point numbers, Japanese names (e.g. `基準点1`), X/Y/H identical to 0.1 mm; file bytes are valid CP932.
2. A hand-written fixture file (`backend/tests/fixtures/sample.sim`) parses with the expected points and parcel blocks.
3. X/Y swap test: a point at E = 100, N = 200 is written as `X = 200, Y = 100`.

## DXF (AutoCAD R2018 via ezdxf)
- `$INSUNITS = 6` (metres). CAD convention: drawing x = easting, y = northing (documented in the file header comment).
- Layers: `SURVEY_POINTS` (POINT + TEXT label), `MEASUREMENTS` (LINE + TEXT value), `SECTION_PLAN` (section line in plan), `PROFILE` (LWPOLYLINE ground line in station/elevation space with grid and labels), `VOLUME_BOUNDARY` (closed LWPOLYLINE), `DESIGN_SURFACE` (3DFACE, import).
- Large coordinates are written in full float64 (no offset), because surveyors expect real plane coordinates in CAD.

### Acceptance criteria
1. Export → re-read with ezdxf: entity counts per layer match, and all coordinates agree within **0.1 mm**.
2. `ezdxf.audit()` reports no errors.
3. Profile DXF: station/elevation vertices match the profile API output within 0.1 mm.

## Sources
- JSIMA "測量データ共通フォーマット" (SIMA). Field order cross-checked with secondary documentation (no official free text available): https://help.informatix.co.jp/sis/9.1/sis/Datasets_CSimaDataset.html
- ezdxf documentation: https://ezdxf.readthedocs.io/
