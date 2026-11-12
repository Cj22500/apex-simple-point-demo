/** TS camera model must agree with the Python one (backend/tests/test_photos.py conventions). */
import { describe, expect, it } from "vitest";
import { projectPoint, rotationRows, verticalFov, type PhotoPose } from "../src/geo/camera";

const base: PhotoPose = { E: -4230, N: -38965, H: 43, yaw: 0, pitch: -90, roll: 0, fx: 532.5, fy: 532.5, cx: 400, cy: 300, width: 800, height: 600 };

describe("camera model", () => {
  it("rows are orthonormal", () => {
    for (const pose of [base, { ...base, yaw: 33.3, pitch: -62.5, roll: 1.25 }]) {
      const R = rotationRows(pose);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const dot = R[i]![0] * R[j]![0] + R[i]![1] * R[j]![1] + R[i]![2] * R[j]![2];
          expect(dot).toBeCloseTo(i === j ? 1 : 0, 12);
        }
    }
  });

  it("nadir, yaw 0: north is up, east is right", () => {
    const n = projectPoint(base, [base.E, base.N + 10, 3]);
    const e = projectPoint(base, [base.E + 10, base.N, 3]);
    expect(n.v).toBeLessThan(base.cy);
    expect(n.u).toBeCloseTo(base.cx, 9);
    expect(e.u).toBeGreaterThan(base.cx);
    expect(e.depth).toBeCloseTo(40, 9);
  });

  it("horizontal camera facing north puts a point straight ahead at the principal point", () => {
    const p = projectPoint({ ...base, pitch: 0 }, [base.E, base.N + 50, base.H]);
    expect(p.u).toBeCloseTo(base.cx, 9);
    expect(p.v).toBeCloseTo(base.cy, 9);
    expect(p.depth).toBeCloseTo(50, 9);
  });

  it("vertical FOV from fy", () => {
    expect(verticalFov(base)).toBeCloseTo((2 * Math.atan(300 / 532.5) * 180) / Math.PI, 12);
  });
});
