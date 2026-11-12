# Spec: As-built surface inspection (出来形管理・面管理)

**Status:** accepted · **Implemented in:** `backend/app/core/asbuilt.py`

## Purpose
After construction, the contractor proves that the finished surface matches the design within the MLIT tolerances (規格値) by comparing a 3D point cloud against the 3D design surface. This is a core use case for construction customers of a point cloud platform.

## Rules implemented (excavation 掘削工, surface management 面管理)
| Surface | Deviation | Mean (平均値) | Individual (個々の計測値) |
|---|---|---|---|
| Flat areas 平場 | vertical (標高較差) | **±50 mm** | **±150 mm** |
| Slopes 法面 (incl. 小段) | horizontal or vertical (水平または標高較差) | **±70 mm** | **±160 mm** |

- Individual tolerances already include **±50 mm** measurement accuracy.
- Evaluate **every point** on the full surface; **all** individual values must be within the tolerance, and the mean must be within the mean tolerance.
- Points within **±5 cm horizontally** of a slope crest/toe (法肩・法尻) are excluded from the vertical evaluation (and within ±5 cm vertically from the horizontal evaluation).
- Measurement density ≥ **1 point/m²** (plan-projected area). Evaluation grid: **1 m × 1 m** (0.5 m × 0.5 m where the construction width is under 1 m), at least 1 point per grid cell.
- When the tolerance changes across the area, the area is split into evaluation sections, or the strictest value is used.
- Other work types (embankment 盛土工, river works, dredging) have different values and are configurable via the tolerance table. Only the excavation table above is verified in this spec.

## Outputs
Per-cell deviation map (min/mean/max), pass/fail per point and per cell, summary (count, mean, σ, max |dev|, % within individual tolerance, density check), and an overall verdict.

## Acceptance criteria
1. Synthetic scan = design surface + known offset field: computed deviations match within **1 mm**.
2. Pass/fail counts are exact for a crafted field with known numbers of out-of-tolerance points.
3. Crest/toe ±5 cm exclusion removes exactly the expected points.
4. Density check flags exactly the cells with 0 points.

## Sources (primary)
- 近畿地方整備局 「出来形管理基準及び規格値（案）」新旧対照 (R4), p.2: 掘削工（面管理の場合）. 平場 標高較差 ±50 / ±150; 法面 ±70 / ±160; 計測精度 ±50 mm included; 1 点/m²; 法肩・法尻 ±5 cm exclusion. https://www.kkr.mlit.go.jp/plan/jigyousya/technical_information/gijutsukanri/kanrikijun/ol9a8v000001l222-att/90_R4_sekokannri(dekigata)(shinnkyuu).pdf
- 国土交通省 「３次元計測技術を用いた出来形管理の監督・検査要領（土工(1,000m3未満)…）（案）」 令和7年3月, p.9 (表-4): 出来形計測 ±50 mm, 1 点以上/0.01 m² at measurement time, 1 点以上/評価グリッド at evaluation; grid 1 m² (0.25 m² if width < 1 m). https://www.mlit.go.jp/tec/constplan/content/001880069.pdf
