import { useState } from "react";
import { formatNumber } from "../geo/format";
import { localizeError, t } from "../i18n";
import type { WorkerIn, WorkerOut } from "../offline/worker";
import { useStore } from "../store";
import { getEngine } from "./engineRef";

interface LocalLayer {
  id: string;
  name: string;
  points: number;
  ms: number;
  visible: boolean;
}

type OfflineStatus =
  | { kind: "reading"; name: string }
  | { kind: "progress"; stage: "decode" | "octree"; pct: number }
  | { kind: "error"; err: unknown }
  | { kind: "done"; name: string; points: number; sec: string }
  | null;

type WorkerOutWithCode = WorkerOut & { code?: string; params?: Record<string, unknown> };

/** Open a LAS/LAZ file entirely in the browser: no upload, no server (WASM + Web Worker). */
export function OfflinePanel() {
  const lang = useStore((s) => s.lang);
  const [layers, setLayers] = useState<LocalLayer[]>([]);
  const [status, setStatus] = useState<OfflineStatus>(null);

  const open = (file: File) => {
    const worker = new Worker(new URL("../offline/worker.ts", import.meta.url), { type: "module" });
    setStatus({ kind: "reading", name: file.name });
    worker.onmessage = (ev: MessageEvent<WorkerOutWithCode>) => {
      const m = ev.data;
      if (m.type === "progress") {
        setStatus({ kind: "progress", stage: m.stage, pct: Math.round(m.value * 100) });
      } else if (m.type === "error") {
        setStatus({ kind: "error", err: { code: m.code, params: m.params, message: m.message } });
        worker.terminate();
      } else {
        const id = `local-${Date.now().toString(36)}`;
        const nodes = new Map(m.nodes);
        const e = getEngine();
        e?.addLayer(id, m.hierarchy, async (_ds, name) => {
          const b = nodes.get(name);
          if (!b) {
            const err = new Error(`missing node ${name}`) as Error & { code?: string; params?: Record<string, unknown> };
            err.code = "ERR_MISSING_NODE";
            err.params = { name };
            throw err;
          }
          return b.slice(0); // the layer keeps views on the buffer; give it its own copy
        });
        e?.lookAt([(m.hierarchy.bounds.min[0] + m.hierarchy.bounds.max[0]) / 2, (m.hierarchy.bounds.min[1] + m.hierarchy.bounds.max[1]) / 2, m.hierarchy.bounds.min[2]], 80);
        setLayers((ls) => [...ls, { id, name: file.name, points: m.hierarchy.points, ms: m.ms, visible: true }]);
        setStatus({ kind: "done", name: file.name, points: m.hierarchy.points, sec: (m.ms / 1000).toFixed(1) });
        worker.terminate();
      }
    };
    file.arrayBuffer().then((buf) => worker.postMessage({ buf, name: file.name } satisfies WorkerIn, [buf]));
  };

  const renderStatus = () => {
    if (!status) return null;
    if (status.kind === "reading") return t(lang, "offline.reading", { name: status.name });
    if (status.kind === "progress") {
      const stage = status.stage === "decode" ? t(lang, "offline.decoding") : t(lang, "offline.buildingOctree");
      return `${stage} ${status.pct}%`;
    }
    if (status.kind === "error") return t(lang, "offline.failed", { detail: localizeError(status.err, lang) });
    return t(lang, "offline.opened", {
      name: status.name,
      points: formatNumber(status.points, lang),
      sec: status.sec,
    });
  };

  return (
    <section>
      <h3>{t(lang, "offline.heading")}</h3>
      <label className="upload">
        {t(lang, "offline.open")}
        <input type="file" accept=".las,.laz" onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ""; }} />
      </label>
      {layers.map((l) => (
        <label key={l.id} className="row check">
          <input type="checkbox" checked={l.visible} onChange={(e) => {
            getEngine()?.setLayerVisible(l.id, e.target.checked);
            setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, visible: e.target.checked } : x)));
          }} />
          <span className="grow">
            {l.name}
            <span className="muted small">
              {" · "}
              {t(lang, "offline.localTag", {
                count: formatNumber(l.points / 1e6, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              })}
            </span>
          </span>
          <button className="icon" title={t(lang, "offline.closeTitle")} onClick={(e) => { e.preventDefault(); getEngine()?.removeLayer(l.id); setLayers((ls) => ls.filter((x) => x.id !== l.id)); }}>✕</button>
        </label>
      ))}
      {status && <div className="small muted">{renderStatus()}</div>}
    </section>
  );
}
