/** Records measured errors for VERIFICATION_REPORT.md (one JSON file per test file). */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";

interface Metric {
  group: string;
  name: string;
  value: number;
  tolerance: number;
  unit: string;
  pass: boolean;
}

export function useMetrics(file: string) {
  const metrics: Metric[] = [];
  afterAll(() => {
    if (!metrics.length) return;
    const dir = fileURLToPath(new URL("../../data/verification/vitest/", import.meta.url));
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}${file}.json`, JSON.stringify(metrics, null, 2));
  });
  return (group: string, name: string, value: number, tolerance: number, unit = "mm") =>
    metrics.push({ group, name, value, tolerance, unit, pass: Math.abs(value) <= tolerance });
}
