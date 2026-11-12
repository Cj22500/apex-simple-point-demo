/** Cross-language check: a node encoded by Python decodes to the exact float64 coordinates in TS. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeNode, nodeByteSize, pointAt } from "../src/engine/decode";
import type { Vec3 } from "../src/engine/types";
import { useMetrics } from "./metrics";

const dir = new URL("../../shared/golden/", import.meta.url);
const meta = JSON.parse(readFileSync(fileURLToPath(new URL("octree_node.json", dir)), "utf-8")) as {
  count: number;
  center: Vec3;
  extras: string[];
  xyz: Vec3[];
  intensity: number[];
  rgb: [number, number, number][];
  classification: number[];
  dz: number[];
};
const file = readFileSync(fileURLToPath(new URL("octree_node.bin", dir)));
const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
const metric = useMetrics("decode");

describe("octree node decoding (Python encoder -> TS decoder)", () => {
  const node = decodeNode(buf, meta.count, meta.extras);

  it("has the documented byte size", () => {
    expect(buf.byteLength).toBe(nodeByteSize(meta.count, meta.extras));
  });

  it("reconstructs float64 coordinates within 0.05 mm at Tokyo scale", () => {
    let worst = 0;
    for (let i = 0; i < meta.count; i++) {
      const p = pointAt(meta.center, node, i);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(p[k]! - meta.xyz[i]![k]!));
    }
    metric("Octree", "TS decode of Python-encoded node (257 pts, ±100 m offsets)", worst * 1000, 0.05);
    expect(worst).toBeLessThan(5e-5);
  });

  it("decodes attributes exactly", () => {
    expect(Array.from(node.index)).toEqual([...Array(meta.count).keys()]);
    expect(Array.from(node.intensity)).toEqual(meta.intensity);
    expect(Array.from(node.classification)).toEqual(meta.classification);
    expect(Array.from(node.rgb)).toEqual(meta.rgb.flat());
    node.extras.dz!.forEach((v, i) => expect(Math.abs(v - meta.dz[i]!)).toBeLessThan(1e-7));
  });

  it("rejects truncated buffers", () => {
    expect(() => decodeNode(buf.slice(0, 100), meta.count, meta.extras)).toThrow(/expected/);
  });
});
