/** The TS offline octree must be identical, node for node, to the Python builder (shuffle=False). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeNode, pointAt } from "../src/engine/decode";
import { buildOctree } from "../src/offline/octreeBuilder";
import { useMetrics } from "./metrics";

const g = JSON.parse(readFileSync(fileURLToPath(new URL("../../shared/golden/octree_build.json", import.meta.url)), "utf-8")) as {
  config: { grid: number; maxLeaf: number; maxDepth: number };
  xyz: [number, number, number][];
  cube: { min: number[]; size: number };
  nodes: { name: string; level: number; count: number; index: number[]; center: number[]; spacing: number; children: number[] }[];
};
const metric = useMetrics("octreeBuilder");

describe("TS octree builder vs Python", () => {
  const xyz = new Float64Array(g.xyz.flat());
  const built = buildOctree({ count: g.xyz.length, xyz }, g.config);

  it("same cube", () => {
    expect(built.hierarchy.cube.size).toBe(g.cube.size);
    expect(built.hierarchy.cube.min).toEqual(g.cube.min);
  });

  it("identical node set, point membership and order", () => {
    expect(built.hierarchy.nodes.map((n) => n.name).sort()).toEqual(g.nodes.map((n) => n.name).sort());
    let mismatched = 0;
    for (const py of g.nodes) {
      const ts = Array.from(built.indices.get(py.name)!);
      if (JSON.stringify(ts) !== JSON.stringify(py.index)) mismatched++;
      const tn = built.hierarchy.nodes.find((n) => n.name === py.name)!;
      expect(tn.center).toEqual(py.center);
      expect(tn.spacing).toBe(py.spacing);
      expect(tn.children).toEqual(py.children);
    }
    metric("Octree", `TS offline builder vs Python: nodes with different point sets (of ${g.nodes.length})`, mismatched, 0, "nodes");
    expect(mismatched).toBe(0);
  });

  it("encoded nodes decode back to the source coordinates", () => {
    let worst = 0;
    for (const nd of built.hierarchy.nodes) {
      const d = decodeNode(built.nodes.get(nd.name)!, nd.count, []);
      for (let k = 0; k < nd.count; k++) {
        const p = pointAt(nd.center, d, k);
        const src = g.xyz[d.index[k]!]!;
        worst = Math.max(worst, ...p.map((v, a) => Math.abs(v - src[a]!)));
      }
    }
    expect(worst).toBeLessThan(5e-5);
  });
});
