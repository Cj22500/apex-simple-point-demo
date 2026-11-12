/** Browser LAS/LAZ reader vs files written by Python laspy (LAZ decoded by laz-perf WASM). */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readHeader, readLas, type LazPerfModule } from "../src/offline/lasReader";
import { useMetrics } from "./metrics";

const dir = new URL("../../shared/golden/", import.meta.url);
const load = (f: string) => {
  const b = readFileSync(fileURLToPath(new URL(f, dir)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const truth = JSON.parse(readFileSync(fileURLToPath(new URL("small_las.json", dir)), "utf-8")) as {
  xyz: number[][];
  intensity: number[];
  rgb: number[][];
  classification: number[];
};
const require = createRequire(import.meta.url);
const lazPerfNode = async () => {
  const mod = require("laz-perf") as { createLazPerf: () => Promise<LazPerfModule> };
  return mod.createLazPerf();
};
const metric = useMetrics("lasReader");

describe.each([["small.las", false], ["small.laz", true]] as const)("%s", (file, compressed) => {
  it("header", () => {
    const h = readHeader(load(file));
    expect(h.compressed).toBe(compressed);
    expect(h.format).toBe(7);
    expect(h.count).toBe(truth.xyz.length);
    expect(h.scale[0]).toBe(1e-4);
  });

  it("points match laspy input", async () => {
    const p = await readLas(load(file), lazPerfNode);
    let worst = 0;
    for (let i = 0; i < p.count; i++) for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(p.xyz[3 * i + a]! - truth.xyz[i]![a]!));
    metric("Offline (browser) reader", `${file}: coordinates vs laspy input`, worst * 1000, 0.1);
    expect(worst).toBeLessThanOrEqual(0.5e-4);
    expect(Array.from(p.intensity!)).toEqual(truth.intensity);
    expect(Array.from(p.classification!)).toEqual(truth.classification);
    expect(Array.from(p.rgb!)).toEqual(truth.rgb.flat());
  });
});

it("rejects non-LAS input", () => {
  expect(() => readHeader(new ArrayBuffer(400))).toThrow(/not a LAS/);
});
