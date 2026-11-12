/**
 * TypeScript port of backend/app/core/octree.py for offline (no-server) viewing.
 * Same algorithm and the same node binary layout, so PointCloudLayer can't tell the difference.
 * Deterministic: the first point (in input order) wins each grid cell, matching the Python
 * builder with shuffle=False; verified node-for-node by tests/octreeBuilder.test.ts.
 */
import type { Hierarchy, HierarchyNode, Vec3 } from "../engine/types";

export interface RawPoints {
  count: number;
  xyz: Float64Array; // interleaved E, N, H (float64)
  intensity?: Uint16Array;
  rgb?: Uint8Array; // interleaved
  classification?: Uint8Array;
}

export interface BuildConfig {
  grid: number;
  maxLeaf: number;
  maxDepth: number;
}

export interface BuiltOctree {
  hierarchy: Hierarchy;
  nodes: Map<string, ArrayBuffer>;
  indices: Map<string, Uint32Array>; // for tests
}

function nodeName(level: number, qx: number, qy: number, qz: number): string {
  let s = "r";
  for (let lv = 1; lv <= level; lv++) {
    const sh = level - lv;
    s += String((((qx >> sh) & 1) << 2) | (((qy >> sh) & 1) << 1) | ((qz >> sh) & 1));
  }
  return s;
}

function encode(p: RawPoints, idx: Uint32Array, center: Vec3): ArrayBuffer {
  const n = idx.length;
  const buf = new ArrayBuffer(n * 22);
  const pos = new Float32Array(buf, 0, 3 * n);
  const ind = new Uint32Array(buf, 12 * n, n);
  const inten = new Uint16Array(buf, 16 * n, n);
  const rgb = new Uint8Array(buf, 18 * n, 3 * n);
  const cls = new Uint8Array(buf, 21 * n, n);
  for (let k = 0; k < n; k++) {
    const i = idx[k]!;
    pos[3 * k] = p.xyz[3 * i]! - center[0];
    pos[3 * k + 1] = p.xyz[3 * i + 1]! - center[1];
    pos[3 * k + 2] = p.xyz[3 * i + 2]! - center[2];
    ind[k] = i;
    inten[k] = p.intensity ? p.intensity[i]! : 0;
    if (p.rgb) {
      rgb[3 * k] = p.rgb[3 * i]!;
      rgb[3 * k + 1] = p.rgb[3 * i + 1]!;
      rgb[3 * k + 2] = p.rgb[3 * i + 2]!;
    } else rgb.fill(200, 3 * k, 3 * k + 3);
    cls[k] = p.classification ? p.classification[i]! : 0;
  }
  return buf;
}

export function buildOctree(p: RawPoints, cfg: BuildConfig = { grid: 128, maxLeaf: 20_000, maxDepth: 12 }, onProgress?: (f: number) => void): BuiltOctree {
  const n = p.count;
  if (!n) throw new Error("empty point cloud");
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = p.xyz[3 * i + a]!;
      if (v < lo[a]!) lo[a] = v;
      if (v > hi[a]!) hi[a] = v;
    }
  }
  let size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  size = size * (1 + 1e-9) + 1e-6; // identical to the Python builder
  const rel = new Float64Array(3 * n);
  for (let i = 0; i < 3 * n; i++) rel[i] = (p.xyz[i]! - lo[i % 3]!) / size;

  let remaining = new Uint32Array(n);
  for (let i = 0; i < n; i++) remaining[i] = i;
  const nodesOut: HierarchyNode[] = [];
  const buffers = new Map<string, ArrayBuffer>();
  const indices = new Map<string, Uint32Array>();
  let placed = 0;

  for (let level = 0; level <= cfg.maxDepth && remaining.length; level++) {
    const cells = 2 ** level;
    const q = (i: number, a: number) => Math.min(Math.floor(rel[3 * i + a]! * cells), cells - 1);
    // stable sort of remaining points by (qx, qy, qz) == Python's key order. Keys are plain
    // numbers ((qx*cells + qy)*cells + qz < 2^53 for cells <= 2^17), ties broken by position.
    const m = remaining.length;
    const keys = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const i = remaining[k]!;
      keys[k] = (q(i, 0) * cells + q(i, 1)) * cells + q(i, 2);
    }
    const order = Array.from({ length: m }, (_, k) => k);
    order.sort((a, b) => keys[a]! - keys[b]! || a - b);
    const next: number[] = [];
    let s = 0;
    while (s < m) {
      const key0 = keys[order[s]!]!;
      let e = s + 1;
      while (e < m && keys[order[e]!] === key0) e++;
      const members: number[] = new Array(e - s);
      for (let t = s; t < e; t++) members[t - s] = remaining[order[t]!]!;
      const first = members[0]!;
      const k0 = { x: q(first, 0), y: q(first, 1), z: q(first, 2) };
      let chosen: number[];
      if (members.length <= cfg.maxLeaf || level === cfg.maxDepth) {
        chosen = members;
      } else {
        const g = cells * cfg.grid;
        const seen = new Set<string | number>();
        const useNum = g ** 3 < Number.MAX_SAFE_INTEGER;
        chosen = [];
        for (const i of members) {
          const gx = Math.min(Math.floor(rel[3 * i]! * g), g - 1);
          const gy = Math.min(Math.floor(rel[3 * i + 1]! * g), g - 1);
          const gz = Math.min(Math.floor(rel[3 * i + 2]! * g), g - 1);
          const key = useNum ? (gx * g + gy) * g + gz : `${gx},${gy},${gz}`;
          if (seen.has(key)) next.push(i);
          else {
            seen.add(key);
            chosen.push(i);
          }
        }
      }
      const nodeSize = size / cells;
      const nmin: Vec3 = [lo[0] + k0.x * nodeSize, lo[1] + k0.y * nodeSize, lo[2] + k0.z * nodeSize];
      const center: Vec3 = [nmin[0] + nodeSize / 2, nmin[1] + nodeSize / 2, nmin[2] + nodeSize / 2];
      const name = nodeName(level, k0.x, k0.y, k0.z);
      const idx = Uint32Array.from(chosen);
      buffers.set(name, encode(p, idx, center));
      indices.set(name, idx);
      nodesOut.push({
        name, level, count: idx.length, min: nmin, max: [nmin[0] + nodeSize, nmin[1] + nodeSize, nmin[2] + nodeSize],
        center, spacing: nodeSize / cfg.grid, leaf: idx.length === members.length, children: [],
      });
      placed += idx.length;
      onProgress?.(placed / n);
      s = e;
    }
    remaining = Uint32Array.from(next);
  }
  const names = new Set(nodesOut.map((nd) => nd.name));
  for (const nd of nodesOut) nd.children = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => names.has(`${nd.name}${c}`));

  let zs: number[] = [];
  const step = Math.max(1, Math.floor(n / 100_000));
  for (let i = 0; i < n; i += step) zs.push(p.xyz[3 * i + 2]!);
  zs = zs.sort((a, b) => a - b);
  const pct = (f: number) => zs[Math.min(zs.length - 1, Math.floor(f * zs.length))]!;
  const hierarchy: Hierarchy = {
    format: "spl-octree-1",
    crs: "unknown (local file)",
    points: n,
    cube: { min: lo, size },
    bounds: { min: lo, max: hi },
    grid: cfg.grid,
    attributes: { extras: [] },
    stats: { z_min: lo[2], z_max: hi[2], z_p01: pct(0.01), z_p99: pct(0.99), intensity_p02: 0, intensity_p98: 65535 },
    nodes: nodesOut,
  };
  return { hierarchy, nodes: buffers, indices };
}
