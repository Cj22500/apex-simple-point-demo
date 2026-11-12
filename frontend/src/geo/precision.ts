/**
 * Precision strategy (see docs/ARCHITECTURE.md §Precision).
 *
 * Absolute JGD2011 coordinates near Tokyo are ~1e4–1e5 m. A float32 has a 24-bit significand, so
 * at 35,000 m adjacent float32 values are 2^-8 m ≈ 3.9 mm apart: absolute float32 storage cannot
 * hold 0.1 mm detail. We store each octree node as a float64 origin + float32 offsets (|offset| ≤
 * node size), and rebuild exact float64 coordinates on pick.
 */
import type { Vec3 } from "./measure";

/** Encode absolute float64 points as float32 offsets from a float64 origin. */
export function encodeOffsets(points: readonly Vec3[], origin: Vec3): Float32Array {
  const out = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    out[i * 3] = p[0] - origin[0];
    out[i * 3 + 1] = p[1] - origin[1];
    out[i * 3 + 2] = p[2] - origin[2];
  });
  return out;
}

/** Rebuild the float64 coordinate of point `index` from origin + float32 offset. */
export function reconstruct(origin: Vec3, offsets: Float32Array, index: number): Vec3 {
  const o = index * 3;
  return [origin[0] + offsets[o]!, origin[1] + offsets[o + 1]!, origin[2] + offsets[o + 2]!];
}

/** What a naive viewer does: store absolute coordinates as float32. Used to demonstrate the failure. */
export function naiveFloat32(p: Vec3): Vec3 {
  return [Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])];
}

/** Spacing between adjacent float32 values at magnitude |x| (unit in the last place). */
export function float32Ulp(x: number): number {
  const a = Math.abs(Math.fround(x));
  if (a === 0) return 2 ** -149;
  const exp = Math.floor(Math.log2(a));
  return 2 ** (exp - 23);
}
