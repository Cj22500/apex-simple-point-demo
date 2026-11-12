import { describe, expect, it } from "vitest";
import { selectNodes, type LodNode, type LodView, type Plane } from "../src/engine/lod";

/** Build a complete quadtree-like octree over a 256 m flat site (z = 0), 4 levels, 1000 pts/node. */
function buildTree(levels = 4): LodNode[] {
  const nodes: LodNode[] = [];
  function add(cx: number, cy: number, size: number, level: number): number {
    const id = nodes.length;
    nodes.push({ cx, cy, cz: 0, radius: (size * Math.sqrt(3)) / 2, count: 1000, children: [] });
    if (level < levels - 1) {
      const h = size / 4;
      for (const [dx, dy] of [[-h, -h], [h, -h], [-h, h], [h, h]] as const) {
        nodes[id]!.children.push(add(cx + dx, cy + dy, size / 2, level + 1));
      }
    }
    return id;
  }
  add(0, 0, 256, 0);
  return nodes;
}

const ALL_INSIDE: Plane[] = [];
const view = (over: Partial<LodView> = {}): LodView => ({
  camera: [0, 0, 300],
  frustum: ALL_INSIDE,
  projFactor: 800,
  pointBudget: 1e9,
  minPixelRadius: 0,
  ...over,
});

describe("LOD selection", () => {
  const tree = buildTree();

  it("selects everything with an unlimited budget", () => {
    expect(selectNodes(tree, view()).visible.length).toBe(tree.length);
  });

  it("never exceeds the point budget", () => {
    for (const budget of [1000, 2500, 7000, 20_000, 50_000]) {
      const r = selectNodes(tree, view({ pointBudget: budget }));
      expect(r.points).toBeLessThanOrEqual(budget);
      expect(r.visible[0]).toBe(0);
    }
  });

  it("always includes the root even if it alone exceeds the budget", () => {
    expect(selectNodes(tree, view({ pointBudget: 10 })).visible).toEqual([0]);
  });

  it("selection is a connected subtree (parents before children)", () => {
    const parent = new Map<number, number>();
    tree.forEach((n, i) => n.children.forEach((c) => parent.set(c, i)));
    const r = selectNodes(tree, view({ pointBudget: 15_000 }));
    const seen = new Set<number>();
    for (const id of r.visible) {
      if (id !== 0) expect(seen.has(parent.get(id)!)).toBe(true);
      seen.add(id);
    }
  });

  it("refines nodes near the camera first", () => {
    // camera low over the +x,+y quadrant: its descendants should win the budget
    const r = selectNodes(tree, view({ camera: [100, 100, 20], pointBudget: 9000 }));
    const deep = r.visible.filter((id) => tree[id]!.radius < 60).map((id) => tree[id]!);
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.every((n) => n.cx > 0 && n.cy > 0)).toBe(true);
  });

  it("culls nodes outside the frustum", () => {
    // only keep x >= 0 (plane x >= 0)
    const r = selectNodes(tree, view({ frustum: [[1, 0, 0, 0]] }));
    expect(r.culled).toBeGreaterThan(0);
    expect(r.visible.every((id) => tree[id]!.cx + tree[id]!.radius >= 0)).toBe(true);
  });

  it("stops refining nodes that are tiny on screen", () => {
    const far = selectNodes(tree, view({ camera: [0, 0, 1e5], minPixelRadius: 20 }));
    expect(far.visible).toEqual([0]);
  });
});
