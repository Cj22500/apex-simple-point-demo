import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { useMetrics } from "./metrics";
import { measure, polygonArea, polylineLength, toJgd, type Vec2, type Vec3 } from "../src/geo/measure";
import { formatGradeDegrees, formatGradePercent, formatLength } from "../src/geo/format";

interface Golden {
  tolerance_m: number;
  target_m: number;
  cases: { name: string; a: Vec3; b: Vec3; expected: Record<string, number | null> }[];
  polygons: { name: string; points: Vec2[]; expectedArea: number }[];
  polylines: { name: string; points: Vec3[]; expectedLength: number }[];
}

const golden: Golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../shared/golden/measurements.json", import.meta.url)), "utf-8"),
);

const TARGET = golden.target_m; // 1e-6 m; the spec's hard limit is 1e-4 m
const metric = useMetrics("measure");
let worst = 0;

describe("measure() vs 50-digit decimal ground truth", () => {
  afterAll(() => metric("Measurements (TypeScript)", `max length error over ${golden.cases.length} cases`, worst * 1000, 0.1));
  for (const c of golden.cases) {
    it(c.name, () => {
      const m = measure(c.a, c.b);
      for (const key of ["dE", "dN", "dH", "horizontal", "distance3d"] as const) {
        const err = Math.abs(m[key] - (c.expected[key] as number));
        worst = Math.max(worst, err);
        expect(err).toBeLessThanOrEqual(TARGET);
      }
      for (const key of ["slopePercent", "slopeDegrees"] as const) {
        const exp = c.expected[key];
        if (exp === null || exp === undefined) expect(m[key]).toBeNull();
        else expect(Math.abs((m[key] as number) - exp)).toBeLessThanOrEqual(1e-6);
      }
    });
  }

  it("never returns NaN or Infinity for degenerate pairs", () => {
    const p: Vec3 = [-5990.4321, -35360.8765, 4];
    const m = measure(p, p);
    expect(Object.values(m).every((v) => v === null || Number.isFinite(v))).toBe(true);
  });
});

describe("polygon area and polyline length", () => {
  for (const p of golden.polygons) {
    it(p.name, () => {
      expect(Math.abs(polygonArea(p.points) - p.expectedArea)).toBeLessThanOrEqual(1e-6);
    });
  }
  for (const l of golden.polylines) {
    it(l.name, () => {
      expect(Math.abs(polylineLength(l.points) - l.expectedLength)).toBeLessThanOrEqual(TARGET);
    });
  }
});

describe("conventions and display", () => {
  it("labels JGD plane coordinates as X = north, Y = east", () => {
    expect(toJgd([100, 200, 3])).toEqual({ X: 200, Y: 100, H: 3 });
  });
  it("formats to 0.1 mm / 0.001 % / 0.0001°", () => {
    expect(formatLength(13)).toBe("13.0000 m");
    expect(formatGradePercent(5)).toBe("5.000 %");
    expect(formatGradeDegrees(2.862405226111748)).toBe("2.8624°");
    expect(formatGradePercent(null)).toBe("vertical");
  });
});
