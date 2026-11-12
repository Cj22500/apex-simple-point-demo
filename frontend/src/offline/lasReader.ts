/**
 * LAS / LAZ reader for the browser (offline mode). LAS is parsed directly; LAZ is decompressed by
 * laz-perf (LASzip compiled to WebAssembly). The laz-perf factory is injected so the same code runs
 * in a Web Worker (web build) and in Vitest (node build).
 */
import type { RawPoints } from "./octreeBuilder";

export interface LasHeader {
  versionMajor: number;
  versionMinor: number;
  pointOffset: number;
  format: number; // 0..10, compression bit removed
  compressed: boolean;
  recordLength: number;
  count: number;
  scale: [number, number, number];
  offset: [number, number, number];
}

// Minimal structural type of the laz-perf Emscripten module.
export interface LazPerfModule {
  HEAPU8: Uint8Array;
  _malloc(n: number): number;
  _free(p: number): void;
  LASZip: new () => { open(ptr: number, len: number): void; getPoint(ptr: number): void; getCount(): number; getPointLength(): number; getPointFormat(): number; delete(): void };
}

const RGB_OFFSET: Record<number, number> = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };

export function readHeader(buf: ArrayBuffer): LasHeader {
  const v = new DataView(buf);
  const sig = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (sig !== "LASF") throw new Error("not a LAS/LAZ file");
  const versionMajor = v.getUint8(24);
  const versionMinor = v.getUint8(25);
  const rawFormat = v.getUint8(104);
  let count = v.getUint32(107, true);
  if (versionMinor >= 4 && count === 0) count = Number(v.getBigUint64(247, true));
  return {
    versionMajor,
    versionMinor,
    pointOffset: v.getUint32(96, true),
    format: rawFormat & 0x3f,
    compressed: (rawFormat & 0x80) !== 0,
    recordLength: v.getUint16(105, true),
    count,
    scale: [v.getFloat64(131, true), v.getFloat64(139, true), v.getFloat64(147, true)],
    offset: [v.getFloat64(155, true), v.getFloat64(163, true), v.getFloat64(171, true)],
  };
}

/** Decode the record starting at byte `b` of `v` (one DataView reused for all points). */
function decodeRecord(h: LasHeader, v: DataView, b: number, i: number, out: RawPoints, rgb16: Uint16Array | null, ro: number | undefined) {
  out.xyz[3 * i] = v.getInt32(b, true) * h.scale[0] + h.offset[0];
  out.xyz[3 * i + 1] = v.getInt32(b + 4, true) * h.scale[1] + h.offset[1];
  out.xyz[3 * i + 2] = v.getInt32(b + 8, true) * h.scale[2] + h.offset[2];
  out.intensity![i] = v.getUint16(b + 12, true);
  out.classification![i] = h.format >= 6 ? v.getUint8(b + 16) : v.getUint8(b + 15) & 0x1f;
  if (ro !== undefined && rgb16) {
    rgb16[3 * i] = v.getUint16(b + ro, true);
    rgb16[3 * i + 1] = v.getUint16(b + ro + 2, true);
    rgb16[3 * i + 2] = v.getUint16(b + ro + 4, true);
  }
}

export async function readLas(buf: ArrayBuffer, lazPerf?: () => Promise<LazPerfModule>, onProgress?: (f: number) => void): Promise<RawPoints> {
  const h = readHeader(buf);
  const n = h.count;
  const out: RawPoints = { count: n, xyz: new Float64Array(3 * n), intensity: new Uint16Array(n), classification: new Uint8Array(n) };
  const hasRgb = RGB_OFFSET[h.format] !== undefined;
  const rgb16 = hasRgb ? new Uint16Array(3 * n) : null;
  const tick = Math.max(1, Math.floor(n / 50));
  const ro = RGB_OFFSET[h.format];

  if (!h.compressed) {
    const view = new DataView(buf);
    for (let i = 0; i < n; i++) {
      decodeRecord(h, view, h.pointOffset + i * h.recordLength, i, out, rgb16, ro);
      if (i % tick === 0) onProgress?.(i / n);
    }
  } else {
    if (!lazPerf) throw new Error("LAZ needs the laz-perf WASM module");
    const lp = await lazPerf();
    const bytes = new Uint8Array(buf);
    const filePtr = lp._malloc(bytes.length);
    lp.HEAPU8.set(bytes, filePtr);
    const zip = new lp.LASZip();
    try {
      zip.open(filePtr, bytes.length);
      const len = zip.getPointLength();
      const recPtr = lp._malloc(len);
      try {
        let heap = lp.HEAPU8;
        let view = new DataView(heap.buffer);
        for (let i = 0; i < n; i++) {
          zip.getPoint(recPtr);
          if (lp.HEAPU8.buffer !== heap.buffer) {
            heap = lp.HEAPU8; // WASM memory grew: the old buffer is detached
            view = new DataView(heap.buffer);
          }
          decodeRecord(h, view, heap.byteOffset + recPtr, i, out, rgb16, ro);
          if (i % tick === 0) onProgress?.(i / n);
        }
      } finally {
        lp._free(recPtr);
      }
    } finally {
      zip.delete();
      lp._free(filePtr);
    }
  }
  if (rgb16) {
    let max = 0;
    for (let i = 0; i < rgb16.length; i += 97) max = Math.max(max, rgb16[i]!);
    const shift = max > 255 ? 8 : 0; // 16-bit colour (spec) vs 8-bit values written by some tools
    out.rgb = new Uint8Array(3 * n);
    for (let i = 0; i < rgb16.length; i++) out.rgb[i] = rgb16[i]! >> shift;
  }
  onProgress?.(1);
  return out;
}
