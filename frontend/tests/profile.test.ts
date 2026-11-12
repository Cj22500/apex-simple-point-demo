import { describe, expect, it } from "vitest";
import { fitScale, groundAt, niceStep } from "../src/geo/profile";

describe("profile view scale", () => {
  it("is true scale at VE = 1 (same px per metre on both axes)", () => {
    const s = fitScale(40, 3, 5, 800, 300, 1);
    const pxPerMx = s.x(1) - s.x(0);
    const pxPerMy = s.y(0) - s.y(1);
    expect(pxPerMy).toBeCloseTo(pxPerMx, 9);
  });

  it("applies vertical exaggeration", () => {
    const s = fitScale(40, 3, 5, 800, 300, 5);
    expect((s.y(0) - s.y(1)) / (s.x(1) - s.x(0))).toBeCloseTo(5, 9);
  });

  it("inverts exactly (cursor read-out)", () => {
    const s = fitScale(37.25, -1.5, 6.25, 640, 260, 2);
    for (const st of [0, 3.3, 37.25]) expect(s.invX(s.x(st))).toBeCloseTo(st, 9);
    for (const z of [-1.5, 2, 6.25]) expect(s.invY(s.y(z))).toBeCloseTo(z, 9);
  });

  it("chooses 1-2-5 grid steps", () => {
    expect(niceStep(40, 8)).toBe(5);
    expect(niceStep(3, 8)).toBe(0.5);
    expect(niceStep(120, 8)).toBe(20);
  });

  it("interpolates the ground line", () => {
    const g: [number, number][] = [[0.05, 3.0], [0.15, 3.005], [0.25, 3.01]];
    expect(groundAt(g, 0.1)).toBeCloseTo(3.0025, 12);
    expect(groundAt(g, -1)).toBe(3.0);
    expect(groundAt(g, 9)).toBe(3.01);
    expect(groundAt([], 1)).toBeNull();
  });
});
