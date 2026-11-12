import { useState } from "react";
import type { WorkerIn, WorkerOut } from "../offline/worker";
import { getEngine } from "./engineRef";

interface LocalLayer {
  id: string;
  name: string;
  points: number;
  ms: number;
  visible: boolean;
}

/** Open a LAS/LAZ file entirely in the browser: no upload, no server (WASM + Web Worker). */
export function OfflinePanel() {
  const [layers, setLayers] = useState<LocalLayer[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const open = (file: File) => {
    const worker = new Worker(new URL("../offline/worker.ts", import.meta.url), { type: "module" });
    setStatus(`Reading ${file.name}…`);
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === "progress") setStatus(`${m.stage === "decode" ? "Decoding (WASM)" : "Building octree"} ${(m.value * 100).toFixed(0)}%`);
      else if (m.type === "error") {
        setStatus(`Failed: ${m.message}`);
        worker.terminate();
      } else {
        const id = `local-${Date.now().toString(36)}`;
        const nodes = new Map(m.nodes);
        const e = getEngine();
        e?.addLayer(id, m.hierarchy, async (_ds, name) => {
          const b = nodes.get(name);
          if (!b) throw new Error(`missing node ${name}`);
          return b.slice(0); // the layer keeps views on the buffer; give it its own copy
        });
        e?.lookAt([(m.hierarchy.bounds.min[0] + m.hierarchy.bounds.max[0]) / 2, (m.hierarchy.bounds.min[1] + m.hierarchy.bounds.max[1]) / 2, m.hierarchy.bounds.min[2]], 80);
        setLayers((ls) => [...ls, { id, name: file.name, points: m.hierarchy.points, ms: m.ms, visible: true }]);
        setStatus(`Opened ${file.name}: ${m.hierarchy.points.toLocaleString()} points in ${(m.ms / 1000).toFixed(1)} s, no server involved`);
        worker.terminate();
      }
    };
    file.arrayBuffer().then((buf) => worker.postMessage({ buf, name: file.name } satisfies WorkerIn, [buf]));
  };

  return (
    <section>
      <h3>Offline (local file, WASM)</h3>
      <label className="upload">
        + Open LAS/LAZ locally (not uploaded)
        <input type="file" accept=".las,.laz" onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ""; }} />
      </label>
      {layers.map((l) => (
        <label key={l.id} className="row check">
          <input type="checkbox" checked={l.visible} onChange={(e) => {
            getEngine()?.setLayerVisible(l.id, e.target.checked);
            setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, visible: e.target.checked } : x)));
          }} />
          <span className="grow">{l.name}<span className="muted small"> · {(l.points / 1e6).toFixed(2)} M pts · local</span></span>
          <button className="icon" title="Close" onClick={(e) => { e.preventDefault(); getEngine()?.removeLayer(l.id); setLayers((ls) => ls.filter((x) => x.id !== l.id)); }}>✕</button>
        </label>
      ))}
      {status && <div className="small muted">{status}</div>}
    </section>
  );
}
