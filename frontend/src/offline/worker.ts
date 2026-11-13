/// <reference lib="webworker" />
/**
 * Offline ingest worker: LAS/LAZ bytes -> points (laz-perf WASM for LAZ) -> octree nodes.
 * Runs off the main thread; node buffers are transferred (zero-copy) back to the viewer.
 */
import { createLazPerf } from "laz-perf/lib/worker/index.js";
import wasmUrl from "laz-perf/lib/worker/laz-perf.wasm?url";
import { readLas, type LazPerfModule } from "./lasReader";
import { buildOctree } from "./octreeBuilder";

export type WorkerIn = { buf: ArrayBuffer; name: string };
export type WorkerOut =
  | { type: "progress"; stage: "decode" | "octree"; value: number }
  | { type: "done"; hierarchy: import("../engine/types").Hierarchy; nodes: [string, ArrayBuffer][]; ms: number }
  | { type: "error"; message: string; code?: string; params?: Record<string, string | number> };

const post = (m: WorkerOut, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const t0 = performance.now();
  try {
    const lazPerf = () => createLazPerf({ locateFile: () => wasmUrl }) as unknown as Promise<LazPerfModule>;
    const pts = await readLas(ev.data.buf, lazPerf, (v) => post({ type: "progress", stage: "decode", value: v }));
    const built = buildOctree(pts, { grid: 128, maxLeaf: 20_000, maxDepth: 12 }, (v) => post({ type: "progress", stage: "octree", value: v }));
    built.hierarchy.crs = "unknown";
    const nodes = [...built.nodes.entries()];
    post({ type: "done", hierarchy: built.hierarchy, nodes, ms: performance.now() - t0 }, nodes.map(([, b]) => b));
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    const params = (err as { params?: Record<string, string | number> } | null)?.params;
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      ...(code ? { code } : {}),
      ...(params ? { params } : {}),
    });
  }
};
