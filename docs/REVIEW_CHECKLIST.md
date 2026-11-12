# Code review checklist (survey / point cloud code)

Used for every PR, including PRs written by AI agents. An agent's "tests pass" is not enough; a reviewer checks the items below.

## Numbers and units
- [ ] Units are explicit (m, mm, %, °, m³) in names, docs or types. No unlabeled magic numbers.
- [ ] Axis convention is correct at every boundary: internal `[E, N, H]`; JGD plane **X = north, Y = east**; DXF x = east; pyproj called with `always_xy=True` or with the authority order handled explicitly.
- [ ] Heights: ellipsoidal (h) vs orthometric (H) is clear, and the geoid model is named (JPGEO2024 default).
- [ ] No float32 on absolute coordinates. Float32 only for offsets from a float64 origin.
- [ ] Angle units: radians internally, degrees only at I/O.

## Verification
- [ ] Each new calculation has a test against **independent** ground truth (analytic, GSI, 50-digit decimal), not against its own output.
- [ ] Tolerances in tests match the spec in `docs/specs/`.
- [ ] Edge cases: zero-length, vertical, empty selection, polygon with no points, NaN/Inf inputs.
- [ ] Results are added to `VERIFICATION_REPORT.md` via `scripts/verify.ps1`.

## Robustness
- [ ] Large inputs are processed vectorized/chunked (no Python loops over points).
- [ ] File parsers reject bad input with clear errors; unknown SIMA records are preserved and warned about.
- [ ] Encodings are explicit (CP932 for SIMA, UTF-8 elsewhere).
- [ ] API errors use proper status codes and don't leak stack traces.

## Security and multi-tenancy
- [ ] Every DB query is scoped by tenant; role checks for write operations.
- [ ] Uploaded file names are never used as paths directly.
