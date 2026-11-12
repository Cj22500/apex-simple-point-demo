/**
 * Proof for the interview: absolute float32 coordinates cannot measure 0.1 mm at Tokyo scale,
 * origin + float32 offset reconstruction can. Acceptance criterion 3 of docs/specs/measurement.md.
 */
import { describe, expect, it } from "vitest";
import { measure, type Vec3 } from "../src/geo/measure";
import { encodeOffsets, float32Ulp, naiveFloat32, reconstruct } from "../src/geo/precision";
import { useMetrics } from "./metrics";

const metric = useMetrics("precision");

const a: Vec3 = [-5995.1852, -35367.2301, 3.21];
const b: Vec3 = [-5995.1851, -35367.2301, 3.21]; // 0.1 mm east of a
const TRUE_DISTANCE = 0.0001;

describe("float precision at JGD2011 Zone IX coordinates", () => {
  it("float32 spacing at 35 km is ~3.9 mm, at 6 km ~0.49 mm", () => {
    expect(float32Ulp(-35367.2301)).toBeCloseTo(2 ** -8, 12); // 3.906 mm
    expect(float32Ulp(-5995.1852)).toBeCloseTo(2 ** -11, 12); // 0.488 mm
  });

  it("NAIVE: two points 0.1 mm apart collapse onto the same float32 value", () => {
    const d = measure(naiveFloat32(a), naiveFloat32(b)).distance3d;
    expect(d).toBe(0); // the 0.1 mm separation is lost completely
  });

  it("NAIVE: absolute float32 storage fails the 0.1 mm tolerance", () => {
    const c: Vec3 = [a[0] + 0.0003, a[1], a[2]]; // 0.3 mm east
    const d = measure(naiveFloat32(a), naiveFloat32(c)).distance3d;
    // only multiples of the 0.49 mm float32 spacing are possible: 0 or 0.488 mm, never 0.3 mm
    metric("Precision", "NAIVE absolute float32: 0.3 mm pair at Tokyo scale (expected FAIL)", Math.abs(d - 0.0003) * 1000, 0.1);
    expect(Math.abs(d - 0.0003)).toBeGreaterThan(1e-4);
  });

  it("NAIVE: a 50 m baseline at 35 km is off by millimetres", () => {
    const p: Vec3 = [-5995.1852, -35367.2301, 3.21];
    const q: Vec3 = [-5945.1852 + 0.0003, -35367.2301 + 0.0007, 3.21];
    const exact = measure(p, q).distance3d;
    const naive = measure(naiveFloat32(p), naiveFloat32(q)).distance3d;
    expect(Math.abs(naive - exact)).toBeGreaterThan(1e-4);
  });

  it("OURS: float64 origin + float32 offset is within 1 µm (100x inside tolerance)", () => {
    const origin: Vec3 = [-6000, -35400, 0]; // node origin (float64)
    const offsets = encodeOffsets([a, b], origin);
    const ra = reconstruct(origin, offsets, 0);
    const rb = reconstruct(origin, offsets, 1);
    // residual is float32 rounding of the ~5–33 m offsets (ulp ≤ 3.8 µm, measured 0.14 µm)
    const err = Math.abs(measure(ra, rb).distance3d - TRUE_DISTANCE);
    metric("Precision", "OURS float64 origin + float32 offset: 0.1 mm pair", err * 1000, 0.1);
    expect(err).toBeLessThan(1e-6);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(ra[i]! - a[i]!)).toBeLessThan(1e-5);
      expect(Math.abs(rb[i]! - b[i]!)).toBeLessThan(1e-5);
    }
  });

  it("OURS: worst case inside a 200 m root node stays below 0.01 mm", () => {
    const origin: Vec3 = [-6000, -35400, 0];
    // offset magnitude ~200 m → float32 ulp 2^-16 m ≈ 15 µm; rounding error ≤ half of that
    const p: Vec3 = [origin[0] + 199.123456, origin[1] + 187.654321, origin[2] + 12.3456];
    const r = reconstruct(origin, encodeOffsets([p], origin), 0);
    const err = Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
    expect(err).toBeLessThan(1e-5);
  });
});
