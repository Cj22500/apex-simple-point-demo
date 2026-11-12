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
3. Box pit 20 × 10 × 3 m: fill = 600 m³; TIN ≤ 1e-6 relative on noise-free samples.
4. Frustum stockpile (R 8, r 2, h 4): 351.858 m³; grid at 0.1 m cells on the synthetic scan with 3 mm noise: ≤ **0.5 %**; grid error decreases monotonically as the cell size goes 0.5 → 0.25 → 0.1 m.
5. Report includes area (m²), cell count, method, and reference elevation.
