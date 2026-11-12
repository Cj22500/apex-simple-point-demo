# Spec: Cut/fill earthwork volume

**Status:** accepted · **Implemented in:** `backend/app/core/volume.py`

## Purpose
Compute cut and fill volumes (m³) of a point cloud surface relative to a horizontal reference plane, inside a plan polygon. Used for stockpile inventory and excavation progress (出来高).

## Methods
- **grid:** DEM with cell size `c` (cell mean of ground points; gaps filled by linear interpolation; cells clipped to the polygon by cell center). `cut = Σ max(z − ref, 0)·c²`, `fill = Σ max(ref − z, 0)·c²`.
- **tin:** Delaunay TIN of the points inside the polygon; exact prism volume per triangle above/below `ref`. Triangles crossing `ref` are split analytically at the intersection line. Exact for piecewise-planar surfaces.

Terminology: *cut* = material above the reference plane (to remove), *fill* = space below the plane (to fill). Net = cut − fill.

## Acceptance criteria (`shared/golden/volumes.json`)
1. TIN on an exact square pyramid (base 10 m, height 6 m): volume 200 m³, relative error ≤ **1e-9**.
2. TIN with the reference plane at half height: above-reference volume 25 m³, relative error ≤ 1e-9 (tests the crossing split).
3. Pit with 1:0.5 walls (top 20 × 10 m, depth 3 m): prismoidal volume **474 m³**. A TIN of its breakline vertices is exact (≤ 1e-9 relative). A TIN of a dense grid *without* breakline constraints is within 0.05 % (measured 0.013 %): Delaunay picks arbitrary cell diagonals across the hip lines. Production should use constrained triangulation.
4. Frustum stockpile (R 8, r 2, h 4): 351.858 m³. On the **cleaned** synthetic scan (σ 3 mm), grid (median, 0.25 m and 0.1 m) and TIN are both within **0.5 %**; a finer grid is not worse. On the raw scan, TIN is biased by outliers (+1.0 %, measured in the UI), so cleaning comes first. The median grid is robust (+0.03 %).
5. Report includes area (m²), cell count, method, and reference elevation.
