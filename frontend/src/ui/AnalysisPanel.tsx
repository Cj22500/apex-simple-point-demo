import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, type Dataset } from "../api/client";
import type { Vec3 } from "../engine/types";
import { downloadCsv, formatArea, formatNumber, formatVolume } from "../geo/format";
import { fitScale, groundAt, niceStep } from "../geo/profile";
import { formatDatasetName, formatDesignSource, localizeError, t, type I18nKey, type Lang } from "../i18n";
import { useStore } from "../store";
import { activeDataset, applyClip, loadProfile, useAnalysis, waitForJob, type ControlPoint } from "./analysisTools";

const mm = (m: number | null | undefined) => (m === null || m === undefined ? "–" : `${(m * 1000).toFixed(1)} mm`);

type JobTask = "clean" | "asbuilt" | "change";

function formatBusyLabel(task: string, lang: Lang): string {
  if (task === "clean") return t(lang, "job.clean");
  if (task === "asbuilt") return t(lang, "job.asbuilt");
  if (task === "change") return t(lang, "job.change");
  return task;
}

function formatBusyValue(val: string, lang: Lang): string {
  const m = val.match(/^(queued|running|done|failed)(?::|\s+)(\d+)%?$/);
  if (!m) return val;
  const statusKey = `jobStatus.${m[1]!}` as I18nKey;
  return `${t(lang, statusKey)} ${m[2]!}%`;
}

async function runDerivedJob(task: JobTask, path: string, body: unknown, hide: string[], after?: () => void) {
  try {
    const r = await api.post<{ datasetId: string; jobId: string }>(path, body);
    await waitForJob(r.jobId, task, { id: r.datasetId, hide });
    after?.();
  } catch (e) {
    const lang = useStore.getState().lang;
    useStore.getState().set({ error: localizeError(e, lang) });
  }
}

function safeDownload(path: string, filename: string, body?: unknown) {
  void api.download(path, filename, body).catch((err) => {
    const lang = useStore.getState().lang;
    useStore.getState().set({ error: localizeError(err, lang) });
  });
}

// ------------------------------------------------------------------ right panel
export function AnalysisPanel() {
  const lang = useStore((s) => s.lang);
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
      {tool === "asbuilt" && <AsBuiltControls ds={ds} canWrite={canWrite} />}
      <section>
        <h3>{t(lang, "proc.heading")} {ds && <span className="muted">· {formatDatasetName(ds, lang)}</span>}</h3>
        {!ds && <div className="muted small">{t(lang, "proc.empty")}</div>}
        {ds && canWrite && <ProcessingControls ds={ds} datasets={datasets} />}
        {Object.entries(a.busy).map(([k, v]) => (
          <div key={k} className="small warn">{formatBusyLabel(k, lang)}: {formatBusyValue(v, lang)}</div>
        ))}
        <Reports ds={ds} />
      </section>
      <ExchangeControls />
    </>
  );
}

function SectionControls() {
  const lang = useStore((s) => s.lang);
  const { section, clip, profileLoading, set } = useAnalysis(useShallow((s) => ({ section: s.section, clip: s.clip, profileLoading: s.profileLoading, set: s.set })));
  const [hw, setHw] = useState(section?.halfWidth ?? 0.5);
  const ds = activeDataset();
  const clipLabel = (m: "off" | "highlight" | "slab") =>
    m === "off" ? t(lang, "section.clip.off") : m === "slab" ? t(lang, "section.clip.slab") : t(lang, "section.clip.highlight");
  return (
    <section>
      <h3>{t(lang, "section.heading")}</h3>
      {!section && <div className="muted small">{t(lang, "section.empty")}</div>}
      <div className="field">
        <span>{t(lang, "section.halfWidth")}</span>
        <input type="number" min={0.05} step={0.05} value={hw} onChange={(e) => setHw(Number(e.target.value))}
          onBlur={() => { if (section) { set({ section: { ...section, halfWidth: hw } }); applyClip(); void loadProfile(); } }} />
      </div>
      <div className="seg">
        {(["off", "highlight", "slab"] as const).map((m) => (
          <button key={m} className={clip === m ? "active" : ""} onClick={() => { set({ clip: m }); applyClip(); }}>
            {clipLabel(m)}
          </button>
        ))}
      </div>
      {section && ds && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="ghost small" disabled={profileLoading} onClick={() => loadProfile()}>
            {profileLoading ? t(lang, "section.loading") : t(lang, "section.refresh")}
          </button>
          <button
            className="ghost small"
            onClick={() => safeDownload(`/datasets/${ds.id}/profile.dxf?lang=${lang}`, "profile.dxf", { a: section.a.slice(0, 2), b: section.b.slice(0, 2), halfWidth: section.halfWidth, binSize: 0.1 })}
          >
            {t(lang, "section.dxf")}
          </button>
          <button className="ghost small danger" onClick={() => { set({ section: null, profile: null }); applyClip(); }}>
            {t(lang, "section.clear")}
          </button>
        </div>
      )}
    </section>
  );
}

function VolumeControls() {
  const lang = useStore((s) => s.lang);
  const { volumePolygon, set } = useAnalysis(useShallow((s) => ({ volumePolygon: s.volumePolygon, set: s.set })));
  const lowest = volumePolygon ? Math.min(...volumePolygon.map((p) => p[2])) : 0;
  const [ref, setRef] = useState<number | null>(null);
  const [method, setMethod] = useState<"grid" | "tin">("grid");
  const [cell, setCell] = useState(0.25);
  const [res, setRes] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const ds = activeDataset();
  useEffect(() => {
    setRef(null);
    setRes(null);
  }, [volumePolygon]);
  const reference = ref ?? Math.round(lowest * 1000) / 1000;
  const body = volumePolygon && { polygon: volumePolygon.map((p) => [p[0], p[1]]), reference, method, cellSize: cell };
  return (
    <section>
      <h3>{t(lang, "volume.heading")}</h3>
      {!volumePolygon && <div className="muted small">{t(lang, "volume.empty")}</div>}
      {volumePolygon && (
        <>
          <div className="field"><span>{t(lang, "volume.refH")}</span><input type="number" step={0.001} value={reference} onChange={(e) => setRef(Number(e.target.value))} /></div>
          <div className="field"><span>{t(lang, "volume.method")}</span>
            <div className="seg">
              {(["grid", "tin"] as const).map((m) => (
                <button key={m} className={method === m ? "active" : ""} onClick={() => setMethod(m)}>
                  {m === "grid" ? t(lang, "volume.method.grid") : t(lang, "volume.method.tin")}
                </button>
              ))}
            </div>
          </div>
          {method === "grid" && <div className="field"><span>{t(lang, "volume.cell")}</span><input type="number" min={0.05} step={0.05} value={cell} onChange={(e) => setCell(Number(e.target.value))} /></div>}
          <div className="row wrap">
            <button className="primary" disabled={!ds || busy} onClick={async () => {
              setBusy(true);
              try {
                setRes(await api.post(`/datasets/${ds!.id}/volume`, body));
              } catch (e) {
                useStore.getState().set({ error: localizeError(e, useStore.getState().lang) });
              }
              setBusy(false);
            }}>{busy ? t(lang, "volume.computing") : t(lang, "volume.compute")}</button>
            <button className="ghost small" disabled={!ds} onClick={() => safeDownload(`/datasets/${ds!.id}/dem.tif`, "dem_epsg6677.tif", body)}>
              {t(lang, "volume.dem")}
            </button>
            <button className="ghost small danger" onClick={() => { set({ volumePolygon: null }); setRes(null); }}>
              {t(lang, "section.clear")}
            </button>
          </div>
          {res && (
            <table className="kv mono" style={{ marginTop: 8 }}>
              <tbody>
                <tr><td>{t(lang, "volume.cut")}</td><td>{formatVolume(res.cut_m3!)}</td></tr>
                <tr><td>{t(lang, "volume.fill")}</td><td>{formatVolume(res.fill_m3!)}</td></tr>
                <tr><td>{t(lang, "volume.net")}</td><td>{formatVolume(res.net_m3!)}</td></tr>
                <tr><td>{t(lang, "volume.area")}</td><td>{formatArea(res.area_m2!)}</td></tr>
                <tr><td>{t(lang, "volume.points")}</td><td>{res.points !== undefined ? formatNumber(res.points, lang) : ""}</td></tr>
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
  const lang = useStore((s) => s.lang);
  const ds = activeDataset();
  const truth = ds?.meta?.truth?.analytic;
  if (!truth) return null;
  return (
    <div className="small muted" style={{ marginTop: 6 }}>
      {t(lang, "volume.truth", {
        stockpile: truth.stockpile_volume_epochA_m3.toFixed(3),
        pit: truth.pit_volume_epochA_m3.toFixed(3),
      })}
    </div>
  );
}

function AsBuiltControls({ ds, canWrite }: { ds: Dataset | null; canWrite: boolean }) {
  const lang = useStore((s) => s.lang);
  const project = useStore((s) => s.project);
  const [design, setDesign] = useState<{ source: string; sourceKey?: string; vertices: number; triangles: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadErr, setUploadErr] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);

  const loadDesign = async (projectId: string) => {
    setLoading(true);
    try {
      const r = await api.get<{ source: string; sourceKey?: string; vertices: unknown[]; triangles: unknown[] }>(`/projects/${projectId}/design`);
      setDesign({ source: r.source, sourceKey: r.sourceKey, vertices: r.vertices.length, triangles: r.triangles.length });
    } catch {
      setDesign(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setUploadErr(null);
    if (project) void loadDesign(project.id);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null;
  const formattedDesign = design ? formatDesignSource(design.source, lang, design.sourceKey) : null;

  return (
    <section>
      <h3>{t(lang, "asbuilt.heading")}</h3>
      <div className="small muted">
        {loading
          ? t(lang, "asbuilt.checking")
          : design && formattedDesign
            ? t(lang, "asbuilt.designLoaded", {
                kind: formattedDesign.isSeeded ? t(lang, "asbuilt.kind.seeded") : t(lang, "asbuilt.kind.uploaded"),
                source: formattedDesign.label,
                tris: formatNumber(design.triangles, lang),
              })
            : t(lang, "asbuilt.noDesign")}
      </div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        {canWrite && (
          <button
            className="primary"
            disabled={!ds || !design}
            onClick={() =>
              ds && runDerivedJob("asbuilt", `/datasets/${ds.id}/asbuilt`, {}, [ds.id], () => useStore.getState().set({ colorMode: "change", dzRange: 0.15 }))
            }
          >
            {t(lang, "asbuilt.run")}
          </button>
        )}
        {design && (
          <a
            className="ghost small"
            href={`/api/projects/${project.id}/design.dxf`}
            download="design_tin.dxf"
            style={{ textDecoration: "none" }}
            onClick={(e) => {
              e.preventDefault();
              safeDownload(`/projects/${project.id}/design.dxf`, "design_tin.dxf");
            }}
          >
            {t(lang, "asbuilt.download")}
          </a>
        )}
      </div>
      {canWrite && (
        <label className="upload">
          {uploading ? t(lang, "asbuilt.uploading") : t(lang, "asbuilt.upload")}
          <input
            type="file"
            accept=".dxf"
            disabled={uploading}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploadErr(null);
              setUploading(true);
              try {
                const r = await api.uploadFile<{ vertices: number; triangles: number }>(`/projects/${project.id}/design`, f);
                setDesign({ source: f.name, sourceKey: "uploaded", vertices: r.vertices, triangles: r.triangles });
              } catch (err) {
                setUploadErr(err);
              } finally {
                setUploading(false);
                e.target.value = "";
              }
            }}
          />
        </label>
      )}
      {uploadErr !== null && <div className="small warn" style={{ marginTop: 4 }}>{localizeError(uploadErr, lang)}</div>}
      <div className="small muted" style={{ marginTop: 6 }}>
        {t(lang, "asbuilt.tolerances")}
      </div>
    </section>
  );
}

function ProcessingControls({ ds, datasets }: { ds: Dataset; datasets: Dataset[] }) {
  const lang = useStore((s) => s.lang);
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
  const run = (task: JobTask, path: string, body: unknown, hide: string[], after?: () => void) =>
    runDerivedJob(task, path, body, hide, after);
  return (
    <>
      <div className="row wrap">
        <button className="ghost small" onClick={() => run("clean", `/datasets/${ds.id}/clean`, { k: 16, nSigma: 1.0 }, [ds.id])} title={t(lang, "proc.cleanTitle")}>
          {t(lang, "proc.clean")}
        </button>
        <button className="ghost small" onClick={() => run("asbuilt", `/datasets/${ds.id}/asbuilt`, {}, [ds.id], () => useStore.getState().set({ colorMode: "change", dzRange: 0.15 }))}
          title={t(lang, "proc.asbuiltTitle")}>
          {t(lang, "proc.asbuilt")}
        </button>
      </div>
      <div className="field"><span>{t(lang, "proc.reference")}</span>
        <select value={refId} onChange={(e) => setRefId(e.target.value)}>{epochs.map((d) => <option key={d.id} value={d.id}>{formatDatasetName(d, lang)}</option>)}</select>
      </div>
      <div className="field"><span>{t(lang, "proc.compared")}</span>
        <select value={cmpId} onChange={(e) => setCmpId(e.target.value)}>{epochs.map((d) => <option key={d.id} value={d.id}>{formatDatasetName(d, lang)}</option>)}</select>
      </div>
      <button className="ghost small" disabled={!refId || !cmpId || refId === cmpId}
        onClick={() => run("change", "/change", { datasetA: refId, datasetB: cmpId }, [ds.id, refId, cmpId], () => useStore.getState().set({ colorMode: "change", dzRange: 0.05 }))}>
        {t(lang, "proc.change")}
      </button>
    </>
  );
}

function Reports({ ds }: { ds: Dataset | null }) {
  const lang = useStore((s) => s.lang);
  const rep = ds?.meta?.report;
  if (!rep) return null;
  if (rep.kind === "sor") {
    return (
      <div className="small" style={{ marginTop: 8 }}>
        {t(lang, "report.sor", {
          removed: formatNumber(rep.removed, lang),
          threshold: rep.threshold_m.toFixed(3),
          kept: formatNumber(rep.kept, lang),
        })}
      </div>
    );
  }
  if (rep.kind === "change") {
    return (
      <table className="kv mono" style={{ marginTop: 8 }}>
        <tbody>
          <tr><td>{t(lang, "report.dzMinMax")}</td><td>{mm(rep.min_m)} / {mm(rep.max_m)}</td></tr>
          <tr><td>{t(lang, "report.dzPct")}</td><td>{mm(rep.p01_m)} / {mm(rep.p99_m)}</td></tr>
          <tr><td>{t(lang, "report.rms")}</td><td>{mm(rep.rms_m)}</td></tr>
          <tr><td>{t(lang, "report.supported")}</td><td>{formatNumber(rep.supported, lang)} / {formatNumber(rep.points, lang)}</td></tr>
        </tbody>
      </table>
    );
  }
  if (rep.kind === "asbuilt") {
    const row = (name: string, r: any, tol: any) => {
      const empty = !r?.points;
      const meanCls = empty ? "muted" : r.mean_ok ? "ok" : "warn";
      const excCls = empty ? "muted" : r.exceeding_individual ? "warn" : "ok";
      return (
        <tr key={name}>
          <td>{name}</td>
          <td>{formatNumber(r?.points ?? 0, lang)}</td>
          <td className={meanCls}>{mm(r?.mean_m)}<br /><span className="muted">±{tol.mean * 1000}</span></td>
          <td className={excCls}>{formatNumber(r?.exceeding_individual ?? 0, lang)}<br /><span className="muted">±{tol.individual * 1000}</span></td>
        </tr>
      );
    };
    const verdict = rep.pass ? t(lang, "report.pass") : t(lang, "report.fail");
    return (
      <div className="asbuilt-report" style={{ marginTop: 8 }}>
        <div className={`verdict ${rep.pass ? "pass" : "fail"}`}>{t(lang, "report.verdict", { verdict })}</div>
        <table className="kv mono" style={{ marginTop: 6 }}>
          <thead>
            <tr className="muted small">
              <td>{t(lang, "report.col.surface")}</td>
              <td>{t(lang, "report.col.pts")}</td>
              <td>{t(lang, "report.col.mean")}</td>
              <td>{t(lang, "report.col.tol")}</td>
            </tr>
          </thead>
          <tbody>
            {row(t(lang, "report.flat"), rep.flat, rep.tolerances_m.flat)}
            {row(t(lang, "report.slope"), rep.slope, rep.tolerances_m.slope)}
            <tr>
              <td>{t(lang, "report.density")}</td>
              <td colSpan={3} className={rep.density.pass ? "ok" : "warn"}>
                {t(lang, "report.cells", {
                  ok: formatNumber(rep.density.cells - rep.density.cells_below_min, lang),
                  total: formatNumber(rep.density.cells, lang),
                })}
              </td>
            </tr>
            <tr>
              <td>{t(lang, "report.breakline")}</td>
              <td colSpan={3}>{t(lang, "report.excluded", { count: formatNumber(rep.excluded_near_breaklines, lang) })}</td>
            </tr>
          </tbody>
        </table>
        <div className="small muted">{t(lang, "report.legendNote")}</div>
      </div>
    );
  }
  return null;
}

type SimaStatus =
  | { kind: "ok"; name: string; points: number; parcels: number; encoding: string; warningsCount: number }
  | { kind: "err"; err: unknown }
  | null;

function ExchangeControls() {
  const lang = useStore((s) => s.lang);
  const project = useStore((s) => s.project);
  const ds = activeDataset();
  const { showControlPoints, set } = useAnalysis(useShallow((s) => ({ showControlPoints: s.showControlPoints, set: s.set })));
  const [simaStatus, setSimaStatus] = useState<SimaStatus>(null);
  if (!project) return null;
  return (
    <section>
      <h3>{t(lang, "exchange.heading")}</h3>
      <label className="row check">
        <input type="checkbox" checked={showControlPoints} onChange={(e) => set({ showControlPoints: e.target.checked })} /> {t(lang, "exchange.showCp")}
      </label>
      <div className="row wrap">
        <button className="ghost small" onClick={() => safeDownload(`/projects/${project.id}/export.sim?lang=${lang}`, "survey_points.sim")}>{t(lang, "exchange.exportSima")}</button>
        <button className="ghost small" onClick={() => safeDownload(`/projects/${project.id}/export.dxf?lang=${lang}`, "survey_plan.dxf")}>{t(lang, "exchange.exportDxf")}</button>
        <button className="ghost small" onClick={() => safeDownload(`/projects/${project.id}/design.dxf`, "design_tin.dxf")}>{t(lang, "exchange.designDxf")}</button>
        {ds && <button className="ghost small" onClick={() => safeDownload(`/datasets/${ds.id}/export.laz`, `${ds.name}.laz`)}>{t(lang, "exchange.downloadLaz")}</button>}
      </div>
      {project.role !== "viewer" && (
        <label className="upload">
          {t(lang, "exchange.importSima")}
          <input type="file" accept=".sim,.txt" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const r = await api.uploadFile<{ siteName?: string; points: number; parcels: number; encoding: string; warnings?: unknown[] }>(
                `/projects/${project.id}/import/sima`,
                f,
              );
              setSimaStatus({
                kind: "ok",
                name: r.siteName || f.name,
                points: r.points,
                parcels: r.parcels,
                encoding: r.encoding,
                warningsCount: r.warnings?.length ?? 0,
              });
              const saved = await api.listMeasurements(project.id);
              useStore.getState().set({ measurements: saved.map((m) => ({ id: m.id, kind: m.kind, label: m.label, points: m.points, savedId: m.id })) });
            } catch (err) {
              setSimaStatus({ kind: "err", err });
            } finally {
              e.target.value = "";
            }
          }} />
        </label>
      )}
      {simaStatus && (
        <div className="small muted">
          {simaStatus.kind === "ok"
            ? t(lang, "exchange.simaSummary", {
                name: simaStatus.name,
                points: formatNumber(simaStatus.points, lang),
                parcels: formatNumber(simaStatus.parcels, lang),
                encoding: simaStatus.encoding,
                warnings: simaStatus.warningsCount ? t(lang, "exchange.simaWarnings", { count: formatNumber(simaStatus.warningsCount, lang) }) : "",
              })
            : localizeError(simaStatus.err, lang)}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ profile drawer (2D CAD view)
export function ProfileDrawer() {
  const lang = useStore((s) => s.lang);
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
      const tVal = Math.min(1, Math.abs(d) / hw);
      g.fillStyle = `rgba(${Math.round(76 + 120 * tVal)}, ${Math.round(201 - 80 * tVal)}, 240, 0.75)`;
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
        <b>{t(lang, "profile.title")}</b>
        <span className="mono small">
          {t(lang, "profile.stats", {
            length: profile.length.toFixed(3),
            points: formatNumber(profile.pointCount, lang),
            zMin: zMin.toFixed(2),
            zMax: zMax.toFixed(2),
          })}
        </span>
        <span className="grow" />
        <span className="small muted">{t(lang, "profile.ve")}</span>
        <div className="seg">{[1, 2, 5, 10].map((v) => <button key={v} className={v === ve ? "active" : ""} onClick={() => setVe(v)}>{v}×</button>)}</div>
        <button className="ghost small" onClick={() => {
          const csv = [t(lang, "profile.csvHeader"), ...profile.ground.map(([s, z]) => `${s.toFixed(4)},${z.toFixed(4)}`)].join("\n");
          downloadCsv("profile.csv", csv);
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
              <text x={Math.max(32, Math.min(scale.x(hover.s) + 6, size.w - 200))} y={30} className="readout">
                {t(lang, "profile.readout", {
                  s: hover.s.toFixed(3),
                  z: (groundAt(profile.ground, hover.s) ?? hover.z).toFixed(3),
                })}
              </text>
            </g>
          )}
        </svg>
        {m && (
          <div className="profile-measure mono small">
            {t(lang, "profile.measure", {
              dS: m.dS.toFixed(4),
              dZ: m.dZ.toFixed(4),
              grade: m.dS !== 0 ? ((m.dZ / m.dS) * 100).toFixed(3) : "∞",
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export type { Vec3 };
