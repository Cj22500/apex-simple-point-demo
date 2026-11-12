import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, type Dataset } from "../api/client";
import type { Vec3 } from "../engine/types";
import { formatArea, formatVolume } from "../geo/format";
import { fitScale, groundAt, niceStep } from "../geo/profile";
import { useStore } from "../store";
import { activeDataset, applyClip, loadProfile, useAnalysis, waitForJob, type ControlPoint } from "./analysisTools";

const mm = (m: number | null | undefined) => (m === null || m === undefined ? "–" : `${(m * 1000).toFixed(1)} mm`);

// ------------------------------------------------------------------ right panel
export function AnalysisPanel() {
  const project = useStore((s) => s.project);
  const datasets = useStore((s) => s.datasets);
  const tool = useStore((s) => s.tool);
  useStore((s) => s.visible); // re-render when the active dataset changes
  const a = useAnalysis();
  const ds = activeDataset();
  const canWrite = project?.role !== "viewer";

  useEffect(() => {
    if (!project) return;
    api.get<ControlPoint[]>(`/projects/${project.id}/control-points`).then((cps) => a.set({ controlPoints: cps })).catch(() => undefined);
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {(tool === "section" || a.section) && <SectionControls />}
      {(tool === "volume" || a.volumePolygon) && <VolumeControls />}
      <section>
        <h3>Processing {ds && <span className="muted">· {ds.name}</span>}</h3>
        {!ds && <div className="muted small">Show a dataset to process it.</div>}
        {ds && canWrite && <ProcessingControls ds={ds} datasets={datasets} />}
        {Object.entries(a.busy).map(([k, v]) => (
          <div key={k} className="small warn">{k}: {v}</div>
        ))}
        <Reports ds={ds} />
      </section>
      <ExchangeControls />
    </>
  );
}

function SectionControls() {
  const { section, clip, profileLoading, set } = useAnalysis(useShallow((s) => ({ section: s.section, clip: s.clip, profileLoading: s.profileLoading, set: s.set })));
  const [hw, setHw] = useState(section?.halfWidth ?? 0.5);
  const ds = activeDataset();
  return (
    <section>
      <h3>Cross-section</h3>
      {!section && <div className="muted small">Click the start and end of the section line in the 3D view.</div>}
      <div className="field">
        <span>Half width (m)</span>
        <input type="number" min={0.05} step={0.05} value={hw} onChange={(e) => setHw(Number(e.target.value))}
          onBlur={() => { if (section) { set({ section: { ...section, halfWidth: hw } }); applyClip(); void loadProfile(); } }} />
      </div>
      <div className="seg">
        {(["off", "highlight", "slab"] as const).map((m) => (
          <button key={m} className={clip === m ? "active" : ""} onClick={() => { set({ clip: m }); applyClip(); }}>
            {m === "off" ? "No clip" : m === "slab" ? "Slab only" : "Highlight"}
          </button>
        ))}
      </div>
      {section && ds && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="ghost small" disabled={profileLoading} onClick={() => loadProfile()}>{profileLoading ? "Loading…" : "Refresh"}</button>
          <button className="ghost small" onClick={() => api.download(`/datasets/${ds.id}/profile.dxf`, "profile.dxf", { a: section.a.slice(0, 2), b: section.b.slice(0, 2), halfWidth: section.halfWidth, binSize: 0.1 })}>
            Profile DXF
          </button>
          <button className="ghost small danger" onClick={() => { set({ section: null, profile: null }); applyClip(); }}>Clear</button>
        </div>
      )}
    </section>
  );
}

function VolumeControls() {
  const { volumePolygon, set } = useAnalysis(useShallow((s) => ({ volumePolygon: s.volumePolygon, set: s.set })));
  const lowest = volumePolygon ? Math.min(...volumePolygon.map((p) => p[2])) : 0;
  const [ref, setRef] = useState<number | null>(null);
  const [method, setMethod] = useState<"grid" | "tin">("grid");
  const [cell, setCell] = useState(0.25);
  const [res, setRes] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const ds = activeDataset();
  const reference = ref ?? Math.round(lowest * 1000) / 1000;
  const body = volumePolygon && { polygon: volumePolygon.map((p) => [p[0], p[1]]), reference, method, cellSize: cell };
  return (
    <section>
      <h3>Cut / fill volume</h3>
      {!volumePolygon && <div className="muted small">Click polygon vertices around the area, then press Enter or double-click.</div>}
      {volumePolygon && (
        <>
          <div className="field"><span>Reference H (m)</span><input type="number" step={0.001} value={reference} onChange={(e) => setRef(Number(e.target.value))} /></div>
          <div className="field"><span>Method</span>
            <div className="seg">
              {(["grid", "tin"] as const).map((m) => <button key={m} className={method === m ? "active" : ""} onClick={() => setMethod(m)}>{m === "grid" ? "Grid DEM" : "TIN (exact)"}</button>)}
            </div>
          </div>
          {method === "grid" && <div className="field"><span>Cell (m)</span><input type="number" min={0.05} step={0.05} value={cell} onChange={(e) => setCell(Number(e.target.value))} /></div>}
          <div className="row wrap">
            <button className="primary" disabled={!ds || busy} onClick={async () => {
              setBusy(true);
              try { setRes(await api.post(`/datasets/${ds!.id}/volume`, body)); } catch (e) { useStore.getState().set({ error: String(e) }); }
              setBusy(false);
            }}>{busy ? "Computing…" : "Compute"}</button>
            <button className="ghost small" disabled={!ds} onClick={() => api.download(`/datasets/${ds!.id}/dem.tif`, "dem_epsg6677.tif", body)}>DEM GeoTIFF</button>
            <button className="ghost small danger" onClick={() => { set({ volumePolygon: null }); setRes(null); }}>Clear</button>
          </div>
          {res && (
            <table className="kv mono" style={{ marginTop: 8 }}>
              <tbody>
                <tr><td>Cut (above ref)</td><td>{formatVolume(res.cut_m3!)}</td></tr>
                <tr><td>Fill (below ref)</td><td>{formatVolume(res.fill_m3!)}</td></tr>
                <tr><td>Net</td><td>{formatVolume(res.net_m3!)}</td></tr>
                <tr><td>Plan area</td><td>{formatArea(res.area_m2!)}</td></tr>
                <tr><td>Points used</td><td>{res.points?.toLocaleString()}</td></tr>
              </tbody>
            </table>
          )}
          <TruthHint />
        </>
      )}
    </section>
  );
}

function TruthHint() {
  const ds = activeDataset();
  const truth = ds?.meta?.truth?.analytic;
  if (!truth) return null;
  return (
    <div className="small muted" style={{ marginTop: 6 }}>
      Analytic truth (synthetic site): stockpile {truth.stockpile_volume_epochA_m3.toFixed(3)} m³ above 3.000 m (epoch A), pit {truth.pit_volume_epochA_m3.toFixed(3)} m³ below 3.000 m.
    </div>
  );
}

function ProcessingControls({ ds, datasets }: { ds: Dataset; datasets: Dataset[] }) {
  const epochs = datasets.filter((d) => d.status === "ready" && d.meta?.derivedBy !== "asbuilt" && d.meta?.derivedBy !== "change");
  const [refId, setRefId] = useState<string>("");
  const [cmpId, setCmpId] = useState<string>("");
  // default to the cleaned version of each epoch when it exists (outliers would show up as "change")
  const best = (epoch: string) =>
    epochs.find((d) => d.epoch === epoch && d.meta?.derivedBy === "clean")?.id ?? epochs.find((d) => d.epoch === epoch)?.id;
  const bestA = best("A") ?? epochs[0]?.id ?? "";
  const bestB = best("B") ?? epochs[1]?.id ?? "";
  useEffect(() => {
    setRefId(bestA);
    setCmpId(bestB);
  }, [bestA, bestB]);
  const run = async (task: string, path: string, body: unknown, after?: () => void) => {
    try {
      const r = await api.post<{ datasetId: string; jobId: string }>(path, body);
      await waitForJob(r.jobId, task, { id: r.datasetId, hide: [ds.id, refId, cmpId] });
      after?.();
    } catch (e) {
      useStore.getState().set({ error: String(e) });
    }
  };
  return (
    <>
      <div className="row wrap">
        <button className="ghost small" onClick={() => run("Cleaning", `/datasets/${ds.id}/clean`, { k: 16, nSigma: 1.0 })} title="Statistical Outlier Removal (k = 16, nσ = 1)">
          Clean (SOR)
        </button>
        <button className="ghost small" onClick={() => run("As-built", `/datasets/${ds.id}/asbuilt`, {}, () => useStore.getState().set({ colorMode: "change", dzRange: 0.15 }))}
          title="Compare with the design surface using MLIT 出来形 tolerances">
          As-built check
        </button>
      </div>
      <div className="field"><span>Reference</span>
        <select value={refId} onChange={(e) => setRefId(e.target.value)}>{epochs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </div>
      <div className="field"><span>Compared</span>
        <select value={cmpId} onChange={(e) => setCmpId(e.target.value)}>{epochs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </div>
      <button className="ghost small" disabled={!refId || !cmpId || refId === cmpId}
        onClick={() => run("Change detection", "/change", { datasetA: refId, datasetB: cmpId }, () => useStore.getState().set({ colorMode: "change", dzRange: 0.05 }))}>
        Change detection (ΔZ)
      </button>
    </>
  );
}

function Reports({ ds }: { ds: Dataset | null }) {
  const rep = ds?.meta?.report;
  if (!rep) return null;
  if (rep.kind === "sor") {
    return <div className="small" style={{ marginTop: 8 }}>SOR removed <b>{rep.removed.toLocaleString()}</b> points (threshold {rep.threshold_m.toFixed(3)} m), kept {rep.kept.toLocaleString()}.</div>;
  }
  if (rep.kind === "change") {
    return (
      <table className="kv mono" style={{ marginTop: 8 }}>
        <tbody>
          <tr><td>ΔZ min / max</td><td>{mm(rep.min_m)} / {mm(rep.max_m)}</td></tr>
          <tr><td>ΔZ p1 / p99</td><td>{mm(rep.p01_m)} / {mm(rep.p99_m)}</td></tr>
          <tr><td>RMS</td><td>{mm(rep.rms_m)}</td></tr>
          <tr><td>Supported</td><td>{rep.supported.toLocaleString()} / {rep.points.toLocaleString()}</td></tr>
        </tbody>
      </table>
    );
  }
  if (rep.kind === "asbuilt") {
    const row = (name: string, r: any, tol: any) => (
      <tr key={name}>
        <td>{name}</td>
        <td>{r.points?.toLocaleString() ?? 0}</td>
        <td className={r.mean_ok ? "ok" : "warn"}>{mm(r.mean_m)}<br /><span className="muted">±{tol.mean * 1000}</span></td>
        <td className={r.exceeding_individual ? "warn" : "ok"}>{r.exceeding_individual ?? 0}<br /><span className="muted">±{tol.individual * 1000}</span></td>
      </tr>
    );
    return (
      <div style={{ marginTop: 8 }}>
        <div className={`verdict ${rep.pass ? "pass" : "fail"}`}>{rep.pass ? "PASS" : "FAIL"} · 出来形 (MLIT 面管理)</div>
        <table className="kv mono" style={{ marginTop: 6 }}>
          <thead><tr className="muted small"><td>Surface</td><td>pts</td><td>mean</td><td>&gt; tol</td></tr></thead>
          <tbody>
            {row("平場 flat", rep.flat, rep.tolerances_m.flat)}
            {row("法面 slope", rep.slope, rep.tolerances_m.slope)}
            <tr><td>Density ≥1 pt/m²</td><td colSpan={3} className={rep.density.pass ? "ok" : "warn"}>{rep.density.cells - rep.density.cells_below_min}/{rep.density.cells} cells</td></tr>
            <tr><td>Crest/toe ±5 cm</td><td colSpan={3}>{rep.excluded_near_breaklines.toLocaleString()} excluded</td></tr>
          </tbody>
        </table>
        <div className="small muted">Colour = deviation from design (±150 mm). Blue = below design (over-dig), red = above.</div>
      </div>
    );
  }
  return null;
}

function ExchangeControls() {
  const project = useStore((s) => s.project);
  const ds = activeDataset();
  const { showControlPoints, set } = useAnalysis(useShallow((s) => ({ showControlPoints: s.showControlPoints, set: s.set })));
  const [msg, setMsg] = useState<string | null>(null);
  if (!project) return null;
  return (
    <section>
      <h3>Exchange (SIMA / DXF / LAS)</h3>
      <label className="row check"><input type="checkbox" checked={showControlPoints} onChange={(e) => set({ showControlPoints: e.target.checked })} /> Show 基準点 (control points)</label>
      <div className="row wrap">
        <button className="ghost small" onClick={() => api.download(`/projects/${project.id}/export.sim`, "survey_points.sim")}>Export SIMA</button>
        <button className="ghost small" onClick={() => api.download(`/projects/${project.id}/export.dxf`, "survey_plan.dxf")}>Export DXF plan</button>
        <button className="ghost small" onClick={() => api.download(`/projects/${project.id}/design.dxf`, "design_tin.dxf")}>Design TIN DXF</button>
        {ds && <button className="ghost small" onClick={() => api.download(`/datasets/${ds.id}/export.laz`, `${ds.name}.laz`)}>Download LAZ</button>}
      </div>
      {project.role !== "viewer" && (
        <label className="upload">
          + Import SIMA (.sim, CP932)
          <input type="file" accept=".sim,.txt" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const fd = new FormData();
            fd.append("file", f);
            try {
              const r = await fetch(`/api/projects/${project.id}/import/sima`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${api.token}` } }).then((x) => x.json());
              setMsg(`${r.siteName || f.name}: ${r.points} points, ${r.parcels} parcels (${r.encoding})${r.warnings?.length ? ` · ${r.warnings.length} warnings` : ""}`);
              const saved = await api.listMeasurements(project.id);
              useStore.getState().set({ measurements: saved.map((m) => ({ id: m.id, kind: m.kind, label: m.label, points: m.points, savedId: m.id })) });
            } catch (err) {
              setMsg(String(err));
            } finally {
              e.target.value = "";
            }
          }} />
        </label>
      )}
      {msg && <div className="small muted">{msg}</div>}
    </section>
  );
}

// ------------------------------------------------------------------ profile drawer (2D CAD view)
export function ProfileDrawer() {
  const { profile, section, set } = useAnalysis(useShallow((s) => ({ profile: s.profile, section: s.section, set: s.set })));
  const [ve, setVe] = useState(1);
  const [size, setSize] = useState({ w: 800, h: 240 });
  const [hover, setHover] = useState<{ s: number; z: number } | null>(null);
  const [marks, setMarks] = useState<{ s: number; z: number }[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(() => setSize({ w: host.current!.clientWidth, h: host.current!.clientHeight }));
    ro.observe(host.current);
    return () => ro.disconnect();
  }, [profile]);

  const scale = useMemo(() => {
    if (!profile || profile.zMin === null || profile.zMax === null) return null;
    return fitScale(profile.length, profile.zMin, profile.zMax, size.w, size.h, ve);
  }, [profile, size, ve]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !scale || !profile) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const hw = section?.halfWidth ?? 1;
    for (const [s, d, z] of profile.points) {
      const t = Math.min(1, Math.abs(d) / hw);
      g.fillStyle = `rgba(${Math.round(76 + 120 * t)}, ${Math.round(201 - 80 * t)}, 240, 0.75)`;
      g.fillRect(scale.x(s) - 1, scale.y(z) - 1, 2, 2);
    }
  }, [profile, scale, size, section]);

  if (!profile || !scale || !section) return null;
  const sStep = niceStep(profile.length, Math.max(4, size.w / 90));
  const zMin = profile.zMin!, zMax = profile.zMax!;
  const zLo = scale.invY(size.h - 20), zHi = scale.invY(20);
  const zStep = niceStep(zHi - zLo, Math.max(3, size.h / 45));
  const groundPath = profile.ground.map(([s, z], i) => `${i ? "L" : "M"}${scale.x(s).toFixed(1)},${scale.y(z).toFixed(1)}`).join("");
  const sTicks: number[] = [];
  for (let s = 0; s <= profile.length + 1e-9; s += sStep) sTicks.push(s);
  const zTicks: number[] = [];
  for (let z = Math.ceil(zLo / zStep) * zStep; z <= zHi; z += zStep) zTicks.push(z);
  const m = marks.length === 2 ? { dS: marks[1]!.s - marks[0]!.s, dZ: marks[1]!.z - marks[0]!.z } : null;

  const toData = (ev: React.MouseEvent) => {
    const r = (ev.currentTarget as SVGElement).getBoundingClientRect();
    return { s: scale.invX(ev.clientX - r.left), z: scale.invY(ev.clientY - r.top) };
  };

  return (
    <div className="profile-drawer">
      <div className="profile-head">
        <b>SEC-1</b>
        <span className="mono small">L = {profile.length.toFixed(3)} m · {profile.pointCount.toLocaleString()} pts · H {zMin.toFixed(2)}–{zMax.toFixed(2)} m</span>
        <span className="grow" />
        <span className="small muted">VE</span>
        <div className="seg">{[1, 2, 5, 10].map((v) => <button key={v} className={v === ve ? "active" : ""} onClick={() => setVe(v)}>{v}×</button>)}</div>
        <button className="ghost small" onClick={() => {
          const csv = ["station_m,elevation_m", ...profile.ground.map(([s, z]) => `${s.toFixed(4)},${z.toFixed(4)}`)].join("\n");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
          a.download = "profile.csv";
          a.click();
        }}>CSV</button>
        <button className="ghost small" onClick={() => useAnalysis.getState().set({ profile: null })}>✕</button>
      </div>
      <div className="profile-body" ref={host}>
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
        <svg width={size.w} height={size.h}
          onMouseMove={(ev) => { const d = toData(ev); setHover(d); set({ profileCursor: Math.max(0, Math.min(profile.length, d.s)) }); }}
          onMouseLeave={() => { setHover(null); set({ profileCursor: null }); }}
          onClick={(ev) => {
            const d = toData(ev);
            const z = groundAt(profile.ground, d.s) ?? d.z; // snap to the ground line
            setMarks((mk) => (mk.length >= 2 ? [{ s: d.s, z }] : [...mk, { s: d.s, z }]));
          }}>
          {sTicks.map((s) => (
            <g key={`s${s}`}>
              <line x1={scale.x(s)} x2={scale.x(s)} y1={18} y2={size.h - 18} className="grid" />
              <text x={scale.x(s)} y={size.h - 4} className="tick" textAnchor="middle">{s.toFixed(sStep < 1 ? 1 : 0)}</text>
            </g>
          ))}
          {zTicks.map((z) => (
            <g key={`z${z}`}>
              <line x1={30} x2={size.w - 10} y1={scale.y(z)} y2={scale.y(z)} className="grid" />
              <text x={4} y={scale.y(z) + 3} className="tick">{z.toFixed(zStep < 1 ? 1 : 0)}</text>
            </g>
          ))}
          <path d={groundPath} className="ground" />
          {marks.map((mk, i) => <circle key={i} cx={scale.x(mk.s)} cy={scale.y(mk.z)} r={4} className="mark" />)}
          {marks.length === 2 && <line x1={scale.x(marks[0]!.s)} y1={scale.y(marks[0]!.z)} x2={scale.x(marks[1]!.s)} y2={scale.y(marks[1]!.z)} className="mline" />}
          {hover && (
            <g>
              <line x1={scale.x(hover.s)} x2={scale.x(hover.s)} y1={18} y2={size.h - 18} className="cursor" />
              <text x={Math.min(scale.x(hover.s) + 6, size.w - 170)} y={30} className="readout">
                STA {hover.s.toFixed(3)} · H {(groundAt(profile.ground, hover.s) ?? hover.z).toFixed(3)}
              </text>
            </g>
          )}
        </svg>
        {m && (
          <div className="profile-measure mono small">
            ΔSTA {m.dS.toFixed(4)} m · ΔH {m.dZ.toFixed(4)} m · grade {m.dS !== 0 ? ((m.dZ / m.dS) * 100).toFixed(3) : "∞"} %
          </div>
        )}
      </div>
    </div>
  );
}

export type { Vec3 };
