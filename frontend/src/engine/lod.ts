/**
 * LOD node selection (pure, testable without WebGL).
 *
 * Breadth-first by screen-space priority: start at the root, repeatedly take the node with the
 * largest projected size, skip it if outside the frustum or too small on screen, and stop adding
 * once the point budget would be exceeded. Children are only considered after their parent, so
 * the selection is always a connected subtree and coarse levels draw while finer ones stream in.
 */
export interface LodNode {
  /** bounding-sphere centre in render (RTC) space */
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  count: number;
  children: number[]; // indices into the node array
}

/** Plane a·x + b·y + c·z + d >= 0 means "inside". */
export type Plane = [number, number, number, number];

export interface LodView {
  camera: [number, number, number];
  frustum: Plane[];
  /** screenHeightPx / (2 tan(fovY / 2)) */
  projFactor: number;
  pointBudget: number;
  /** nodes projected smaller than this (pixels of sphere radius) are not refined */
  minPixelRadius: number;
}

export interface LodResult {
  visible: number[]; // in priority order
  points: number;
  culled: number;
}

export function sphereInFrustum(n: LodNode, planes: readonly Plane[]): boolean {
  for (const [a, b, c, d] of planes) {
    if (a * n.cx + b * n.cy + c * n.cz + d < -n.radius) return false;
  }
  return true;
}

export function screenRadius(n: LodNode, view: LodView): number {
  const dx = n.cx - view.camera[0];
  const dy = n.cy - view.camera[1];
  const dz = n.cz - view.camera[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - n.radius;
  if (dist <= 1e-6) return Number.POSITIVE_INFINITY; // camera inside the node
  return (n.radius / dist) * view.projFactor;
}

/** Binary max-heap keyed by priority. */
class MaxHeap {
  private items: { id: number; p: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(id: number, p: number) {
    const a = this.items;
    a.push({ id, p });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]!.p >= a[i]!.p) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): { id: number; p: number } {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.p > a[m]!.p) m = l;
        if (r < a.length && a[r]!.p > a[m]!.p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function selectNodes(nodes: readonly LodNode[], view: LodView, root = 0): LodResult {
  const visible: number[] = [];
  let points = 0;
  let culled = 0;
  const heap = new MaxHeap();
  if (!nodes.length) return { visible, points, culled };
  heap.push(root, Number.POSITIVE_INFINITY);
  while (heap.size) {
    const { id } = heap.pop();
    const n = nodes[id]!;
    if (!sphereInFrustum(n, view.frustum)) {
      culled++;
      continue;
    }
    const sr = screenRadius(n, view);
    if (id !== root && sr < view.minPixelRadius) continue;
    if (points + n.count > view.pointBudget) {
      if (visible.length === 0) {
        visible.push(id); // always show at least the root
        points += n.count;
      }
      break;
    }
    visible.push(id);
    points += n.count;
    for (const c of n.children) {
      const child = nodes[c]!;
      heap.push(c, screenRadius(child, view));
    }
  }
  return { visible, points, culled };
}
