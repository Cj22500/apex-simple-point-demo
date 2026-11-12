/**
 * Decode one octree node (layout documented in backend/app/core/octree.py):
 * float32[3n] offsets | float32[n] per extra | uint32[n] index | uint16[n] intensity | uint8[3n] rgb | uint8[n] class
 * All sections are naturally aligned, so typed-array views need no copies.
 */
import type { DecodedNode, Vec3 } from "./types";

export function nodeByteSize(count: number, extras: readonly string[]): number {
  return count * (22 + 4 * extras.length);
}

export function decodeNode(buf: ArrayBuffer, count: number, extras: readonly string[]): DecodedNode {
  const expected = nodeByteSize(count, extras);
  if (buf.byteLength !== expected) {
    throw new Error(`node size ${buf.byteLength} B, expected ${expected} B for ${count} points`);
  }
  let off = 0;
  const position = new Float32Array(buf, off, 3 * count);
  off += 12 * count;
  const extraArrays: Record<string, Float32Array> = {};
  for (const name of extras) {
    extraArrays[name] = new Float32Array(buf, off, count);
    off += 4 * count;
  }
  const index = new Uint32Array(buf, off, count);
  off += 4 * count;
  const intensity = new Uint16Array(buf, off, count);
  off += 2 * count;
  const rgb = new Uint8Array(buf, off, 3 * count);
  off += 3 * count;
  const classification = new Uint8Array(buf, off, count);
  return { count, position, index, intensity, rgb, classification, extras: extraArrays };
}

/** Exact float64 coordinate of point i: node centre (float64) + float32 offset. */
export function pointAt(center: Vec3, node: DecodedNode, i: number): Vec3 {
  const p = node.position;
  return [center[0] + p[3 * i]!, center[1] + p[3 * i + 1]!, center[2] + p[3 * i + 2]!];
}
