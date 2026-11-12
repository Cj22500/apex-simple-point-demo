import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import type { ColorMode } from "../engine/PointCloudEngine";
import { formatArea, formatDelta, formatGradeDegrees, formatGradePercent, formatLength } from "../geo/format";
import { measure, polygonArea, polylineLength, toJgd } from "../geo/measure";
import { useStore, type MeasurementItem, type Tool } from "../store";
import { getEngine } from "./engineRef";
import { measurementLabel } from "./Viewer";

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "navigate", label: "Navigate", hint: "Drag to orbit, right-drag to pan, wheel to zoom, double-click to focus" },
  { id: "point", label: "Point", hint: "Click a point to read its JGD2011 coordinates" },
  { id: "distance", label: "Distance", hint: "Click two points: 3D/horizontal distance, ΔX/ΔY/ΔH, grade" },
  { id: "polyline", label: "Polyline", hint: "Click points, double-click or Enter to finish" },
  { id: "area", label: "Area", hint: "Click polygon vertices, double-click or Enter to finish (plan area)" },
  { id: "section", label: "Section", hint: "Click two points to cut a cross-section" },
  { id: "volume", label: "Volume", hint: "Click a polygon, Enter to compute cut/fill" },
  { id: "asbuilt", label: "As-built", hint: "Check the pit against its design surface (MLIT 出来形)" },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const hint = TOOLS.find((t) => t.id === tool)?.hint;
  return (
    <div className="toolbar">
      <div className="brand">
        Simple-Point <span>Lite</span>
      </div>
      <div className="tools" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={t.id === tool ? "active" : ""} onClick={() => setTool(t.id)} title={t.hint}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="hint">{hint}</div>
    </div>
  );
}

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: "rgb", label: "RGB" },
  { id: "elevation", label: "Elevation" },
  { id: "intensity", label: "Intensity" },
  { id: "classification", label: "Classification" },
  { id: "change", label: "Change ΔZ" },
];

export function LayerPanel() {
  const s = useStore(
    useShallow((s) => ({
      project: s.project,
      datasets: s.datasets,
      visible: s.visible,
      colorMode: s.colorMode,
      pointBudget: s.pointBudget,
      pointSize: s.pointSize,
      sizeMode: s.sizeMode,
      edl: s.edl,
      zRange: s.zRange,
      dzRange: s.dzRange,
      set: s.set,
    })),
  );
  const hasDz = s.datasets.some((d) => s.visible[d.id] && (d.meta?.attributes ?? []).includes("dz"));
  return (
    <aside className="panel left">
      <section>
        <h3>Project</h3>
        <div className="muted small">{s.project?.name}</div>
        <div className="muted small">JGD2011 Zone IX (EPSG:6677) · JPGEO2024 heights</div>
      </section>
      <section>
        <h3>Layers</h3>
        {s.datasets.map((d) => (
          <label key={d.id} className="row check">
            <input
              type="checkbox"
              disabled={d.status !== "ready"}
              checked={!!s.visible[d.id]}
              onChange={(e) => s.set({ visible: { ...s.visible, [d.id]: e.target.checked } })}
            />
            <span className="grow">
              {d.name}
              <span className="muted small"> · {d.status === "ready" ? `${(d.pointCount / 1e6).toFixed(2)} M pts` : d.status}</span>
            </span>
          </label>
        ))}
        <UploadButton />
      </section>
      <section>
        <h3>Color</h3>
        <div className="seg">
          {COLOR_MODES.map((m) => (
            <button key={m.id} className={m.id === s.colorMode ? "active" : ""} onClick={() => s.set({ colorMode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        {s.colorMode === "elevation" && s.zRange && (
          <div className="range2">
            <label>
              min H <input type="number" step="0.5" value={s.zRange[0]} onChange={(e) => s.set({ zRange: [Number(e.target.value), s.zRange![1]] })} />
            </label>
            <label>
              max H <input type="number" step="0.5" value={s.zRange[1]} onChange={(e) => s.set({ zRange: [s.zRange![0], Number(e.target.value)] })} />
            </label>
            <div className="legend turbo" />
          </div>
        )}
        {s.colorMode === "change" && (
          <div>
            <label className="row">
              ±range <input type="range" min={0.01} max={0.5} step={0.005} value={s.dzRange} onChange={(e) => s.set({ dzRange: Number(e.target.value) })} />
              <span className="mono">{(s.dzRange * 1000).toFixed(0)} mm</span>
            </label>
            <div className="legend diverging" />
            <div className="row small muted spread"><span>−{(s.dzRange * 1000).toFixed(0)} mm (lower)</span><span>+{(s.dzRange * 1000).toFixed(0)} mm (higher)</span></div>
            {!hasDz && <div className="warn small">Run Change detection (right panel) to compute ΔZ.</div>}
          </div>
        )}
      </section>
      <section>
        <h3>Rendering</h3>
        <label className="row">
          Point budget
          <input type="range" min={250_000} max={10_000_000} step={250_000} value={s.pointBudget} onChange={(e) => s.set({ pointBudget: Number(e.target.value) })} />
          <span className="mono">{(s.pointBudget / 1e6).toFixed(2)} M</span>
        </label>
        <label className="row">
          Point size
          <input type="range" min={0.5} max={4} step={0.1} value={s.pointSize} onChange={(e) => s.set({ pointSize: Number(e.target.value) })} />
          <span className="mono">{s.pointSize.toFixed(1)}</span>
        </label>
        <label className="row check">
          <input type="checkbox" checked={s.sizeMode === "adaptive"} onChange={(e) => s.set({ sizeMode: e.target.checked ? "adaptive" : "fixed" })} />
          Adaptive size (LOD spacing)
        </label>
        <label className="row check">
          <input type="checkbox" checked={s.edl} onChange={(e) => s.set({ edl: e.target.checked })} />
          Eye-Dome Lighting
        </label>
        <button className="ghost" onClick={() => getEngine()?.fitView()}>Reset view</button>
      </section>
    </aside>
  );
}

function UploadButton() {
  const project = useStore((s) => s.project);
  if (!project || project.role === "viewer") return null;
  return (
    <label className="upload">
      + Upload LAS/LAZ/E57/PLY/PTS/XYZ
      <input
        type="file"
        accept=".las,.laz,.e57,.ply,.pts,.xyz,.txt,.csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const { set } = useStore.getState();
          try {
            const { jobId } = await api.upload(project.id, f, f.name);
            set({ datasets: await api.datasets(project.id) });
            for (;;) {
              await new Promise((r) => setTimeout(r, 1000));
              const job = await api.job(jobId);
              if (job.status === "done" || job.status === "failed") {
                if (job.status === "failed") set({ error: `Ingest failed: ${job.error}` });
                break;
              }
            }
            set({ datasets: await api.datasets(project.id) });
          } catch (err) {
            set({ error: String(err) });
          } finally {
            e.target.value = "";
          }
        }}
      />
    </label>
  );
}

export function Hud() {
  const stats = useStore((s) => s.stats);
  const budget = useStore((s) => s.pointBudget);
  if (!stats) return null;
  return (
    <div className="hud mono" aria-label="Rendering statistics">
      <div><b>{stats.fps.toFixed(0)}</b> FPS</div>
      <div>{(stats.visiblePoints / 1e6).toFixed(2)} M / {(budget / 1e6).toFixed(1)} M pts</div>
      <div>{stats.visibleNodes} nodes · {stats.pending} loading</div>
      <div>GPU ≈ {stats.gpuMB.toFixed(0)} MB</div>
    </div>
  );
}

export function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const err = useStore((s) => s.error);
  const set = useStore((s) => s.set);
  const j = cursor ? toJgd(cursor.position) : null;
  return (
    <footer className="statusbar mono">
      {j ? (
        <span>
          X {j.X.toFixed(4)} · Y {j.Y.toFixed(4)} · H {j.H.toFixed(4)} m
          {cursor?.dz !== undefined && ` · ΔZ ${(cursor.dz * 1000).toFixed(1)} mm`}
        </span>
      ) : (
        <span className="muted">Hover the cloud to read JGD2011 plane coordinates (X = north, Y = east)</span>
      )}
      {err && (
        <span className="error" onClick={() => set({ error: null })} title="dismiss">
          {err} ✕
        </span>
      )}
    </footer>
  );
}

// ------------------------------------------------------------------ measurements
function rows(m: MeasurementItem): [string, string][] {
  const p = m.points;
  if (m.kind === "distance" && p.length === 2) {
    const r = measure(p[0]!, p[1]!);
    return [
      ["3D distance", formatLength(r.distance3d)],
      ["Horizontal", formatLength(r.horizontal)],
      ["ΔX (north)", formatDelta(r.dN)],
      ["ΔY (east)", formatDelta(r.dE)],
      ["ΔH", formatDelta(r.dH)],
      ["Grade", formatGradePercent(r.slopePercent)],
      ["Angle", formatGradeDegrees(r.slopeDegrees)],
    ];
  }
  if (m.kind === "polyline") {
    return [
      ["Length 3D", formatLength(polylineLength(p))],
      ["Length 2D", formatLength(polylineLength(p.map((q) => [q[0], q[1], 0] as const)))],
      ["Vertices", String(p.length)],
    ];
  }
  if (m.kind === "area") {
    return [
      ["Plan area", formatArea(polygonArea(p.map((q) => [q[0], q[1]] as const)))],
      ["Perimeter 2D", formatLength(polylineLength([...p, p[0]!].map((q) => [q[0], q[1], 0] as const)))],
      ["Vertices", String(p.length)],
    ];
  }
  const j = toJgd(p[0]!);
  return [
    ["X (north)", j.X.toFixed(4)],
    ["Y (east)", j.Y.toFixed(4)],
    ["H", j.H.toFixed(4)],
  ];
}

function toCsv(ms: MeasurementItem[]): string {
  const head = "id,kind,label,vertex,X_north,Y_east,H,result";
  const lines = ms.flatMap((m) =>
    m.points.map((p, i) => {
      const j = toJgd(p);
      const res = i === 0 ? rows(m).map(([k, v]) => `${k}=${v}`).join("; ") : "";
      return [m.id, m.kind, JSON.stringify(m.label), i + 1, j.X.toFixed(4), j.Y.toFixed(4), j.H.toFixed(4), JSON.stringify(res)].join(",");
    }),
  );
  return [head, ...lines].join("\n");
}

export function MeasurementPanel() {
  const { measurements, selectedId, project, set, update, remove, lastPick } = useStore(
    useShallow((s) => ({
      measurements: s.measurements,
      selectedId: s.selectedId,
      project: s.project,
      set: s.set,
      update: s.updateMeasurement,
      remove: s.removeMeasurement,
      lastPick: s.lastPick,
    })),
  );
  const sel = measurements.find((m) => m.id === selectedId) ?? null;
  const canWrite = project && project.role !== "viewer";

  const crossCheck = async (m: MeasurementItem) => {
    const server = await api.measure(m.kind, m.points);
    const local: Record<string, number | null> =
      m.kind === "distance" ? { ...measure(m.points[0]!, m.points[1]!) } : m.kind === "polyline" ? { length3d: polylineLength(m.points) } : {};
    let worst = 0;
    for (const [k, v] of Object.entries(local)) {
      const sv = server[k];
      if (typeof v === "number" && typeof sv === "number" && !k.startsWith("slope")) worst = Math.max(worst, Math.abs(v - sv));
    }
    update(m.id, { serverCheck: { maxDiffMm: worst * 1000 } });
  };

  return (
    <>
      <section>
        <h3>Last picked point</h3>
        {lastPick ? (
          <table className="kv mono">
            <tbody>
              <tr><td>X (north)</td><td>{lastPick.position[1].toFixed(4)}</td></tr>
              <tr><td>Y (east)</td><td>{lastPick.position[0].toFixed(4)}</td></tr>
              <tr><td>H (標高)</td><td>{lastPick.position[2].toFixed(4)}</td></tr>
              {lastPick.geo && (
                <>
                  <tr><td>Lat</td><td>{lastPick.geo.lat.toFixed(9)}°</td></tr>
                  <tr><td>Lon</td><td>{lastPick.geo.lon.toFixed(9)}°</td></tr>
                  <tr><td>h (ellipsoid)</td><td>{lastPick.geo.h.toFixed(4)}</td></tr>
                  <tr><td>N ({lastPick.geo.model})</td><td>{lastPick.geo.N.toFixed(4)}{lastPick.geo.approximate ? " ⚠ approx" : ""}</td></tr>
                </>
              )}
            </tbody>
          </table>
        ) : (
          <div className="muted small">Pick a point with any tool.</div>
        )}
      </section>
      <section>
        <div className="row spread">
          <h3>Measurements</h3>
          {measurements.length > 0 && (
            <button
              className="ghost small"
              onClick={() => {
                const blob = new Blob([toCsv(measurements)], { type: "text/csv" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "measurements.csv";
                a.click();
              }}
            >
              CSV
            </button>
          )}
        </div>
        {measurements.length === 0 && <div className="muted small">Use Distance, Polyline or Area. Values are float64, shown to 0.1 mm.</div>}
        <ul className="mlist">
          {measurements.map((m) => (
            <li key={m.id} className={m.id === selectedId ? "sel" : ""} onClick={() => set({ selectedId: m.id })}>
              <span className="tag">{m.kind}</span>
              <span className="mono grow">{m.label || measurementLabel(m)}</span>
              {m.savedId && <span title="saved to project">●</span>}
            </li>
          ))}
        </ul>
        {sel && (
          <div className="detail">
            <table className="kv mono">
              <tbody>
                {rows(sel).map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="row wrap">
              <button className="ghost small" onClick={() => getEngine()?.lookAt(sel.points[0]!, 30)}>Zoom to</button>
              <button className="ghost small" onClick={() => crossCheck(sel)}>Server cross-check</button>
              {canWrite && !sel.savedId && (
                <button
                  className="ghost small"
                  onClick={async () => {
                    const saved = await api.saveMeasurement(project!.id, { kind: sel.kind, label: sel.label, points: sel.points });
                    update(sel.id, { savedId: saved.id });
                  }}
                >
                  Save to project
                </button>
              )}
              <button
                className="ghost small danger"
                onClick={async () => {
                  if (sel.savedId && project) await api.deleteMeasurement(project.id, sel.savedId);
                  remove(sel.id);
                }}
              >
                Delete
              </button>
            </div>
            {sel.serverCheck && (
              <div className={`small ${sel.serverCheck.maxDiffMm <= 0.1 ? "ok" : "warn"}`}>
                Browser vs Python: max difference {sel.serverCheck.maxDiffMm.toExponential(2)} mm
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
