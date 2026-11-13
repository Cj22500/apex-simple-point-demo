import { useShallow } from "zustand/react/shallow";
import { ApiError, api } from "../api/client";
import type { ColorMode } from "../engine/PointCloudEngine";
import { downloadCsv, formatArea, formatDelta, formatGradeDegrees, formatGradePercent, formatLength, formatNumber, formatProjectCrs } from "../geo/format";
import { measure, polygonArea, polylineLength, toJgd } from "../geo/measure";
import { formatDatasetName, formatProjectName, localizeError, t, type I18nKey, type Lang } from "../i18n";
import { useStore, type MeasurementItem, type Tool } from "../store";
import { getEngine } from "./engineRef";
import { OfflinePanel } from "./OfflinePanel";
import { measurementLabel } from "./Viewer";

const TOOLS: { id: Tool; labelKey: I18nKey; hintKey: I18nKey }[] = [
  { id: "navigate", labelKey: "tool.navigate.label", hintKey: "tool.navigate.hint" },
  { id: "point", labelKey: "tool.point.label", hintKey: "tool.point.hint" },
  { id: "distance", labelKey: "tool.distance.label", hintKey: "tool.distance.hint" },
  { id: "polyline", labelKey: "tool.polyline.label", hintKey: "tool.polyline.hint" },
  { id: "area", labelKey: "tool.area.label", hintKey: "tool.area.hint" },
  { id: "section", labelKey: "tool.section.label", hintKey: "tool.section.hint" },
  { id: "volume", labelKey: "tool.volume.label", hintKey: "tool.volume.hint" },
  { id: "asbuilt", labelKey: "tool.asbuilt.label", hintKey: "tool.asbuilt.hint" },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const activeTool = TOOLS.find((item) => item.id === tool);
  const hint = activeTool ? t(lang, activeTool.hintKey) : undefined;
  return (
    <div className="toolbar">
      <div className="brand">
        Simple-Point <span>Lite</span>
      </div>
      <div className="tools" role="toolbar" aria-label={t(lang, "toolbar.aria")}>
        {TOOLS.map((item) => {
          const itemHint = t(lang, item.hintKey);
          return (
            <button
              key={item.id}
              className={item.id === tool ? "active" : ""}
              onClick={() => setTool(item.id)}
              title={itemHint}
            >
              {t(lang, item.labelKey)}
            </button>
          );
        })}
      </div>
      <div className="hint">{hint}</div>
      <div className="lang-toggle" role="group" aria-label={t(lang, "lang.aria")}>
        <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")} aria-pressed={lang === "en"}>
          EN
        </button>
        <button type="button" className={lang === "ja" ? "active" : ""} onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>
          日本語
        </button>
      </div>
    </div>
  );
}

const COLOR_MODES: { id: ColorMode; labelKey: I18nKey }[] = [
  { id: "rgb", labelKey: "color.rgb" },
  { id: "elevation", labelKey: "color.elevation" },
  { id: "intensity", labelKey: "color.intensity" },
  { id: "classification", labelKey: "color.classification" },
  { id: "change", labelKey: "color.change" },
];

export function LayerPanel() {
  const s = useStore(
    useShallow((s) => ({
      lang: s.lang,
      project: s.project,
      datasets: s.datasets,
      visible: s.visible,
      error: s.error,
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
  const { lang } = s;
  const hasDz = s.datasets.some((d) => s.visible[d.id] && (d.meta?.attributes ?? []).includes("dz"));
  const dzMm = (s.dzRange * 1000).toFixed(0);
  return (
    <aside className="panel left">
      <section>
        <h3>{t(lang, "project.heading")}</h3>
        <div className="muted small">{s.project ? formatProjectName(s.project.name, lang) : ""}</div>
        <div className="muted small">{formatProjectCrs(s.project?.crs, s.project?.geoidModel, lang)}</div>
      </section>
      <section>
        <h3>{t(lang, "layers.heading")}</h3>
        {s.datasets.length === 0 && !s.error && <div className="muted small">{t(lang, "layers.seeding")}</div>}
        {s.datasets.map((d) => (
          <label key={d.id} className="row check">
            <input
              type="checkbox"
              disabled={d.status !== "ready"}
              checked={!!s.visible[d.id]}
              onChange={(e) => s.set({ visible: { ...s.visible, [d.id]: e.target.checked } })}
            />
            <span className="grow">
              {formatDatasetName(d, lang)}
              <span className="muted small">
                {" · "}
                {d.status === "ready"
                  ? t(lang, "layers.points", { count: formatNumber(d.pointCount / 1e6, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })
                  : t(lang, d.status === "processing" ? "layers.status.processing" : "layers.status.failed")}
              </span>
            </span>
            {d.parentId && s.project?.role !== "viewer" && (
              <button
                className="icon"
                title={t(lang, "layers.deleteTitle")}
                onClick={async (e) => {
                  e.preventDefault();
                  try {
                    await api.del(`/datasets/${d.id}`);
                    const st = useStore.getState();
                    const visible = { ...st.visible };
                    delete visible[d.id];
                    st.set({ datasets: await api.datasets(s.project!.id), visible });
                  } catch (err) {
                    const st = useStore.getState();
                    st.set({ error: localizeError(err, st.lang) });
                  }
                }}
              >
                ✕
              </button>
            )}
          </label>
        ))}
        <UploadButton />
      </section>
      <OfflinePanel />
      <section>
        <h3>{t(lang, "color.heading")}</h3>
        <div className="seg">
          {COLOR_MODES.map((m) => (
            <button key={m.id} className={m.id === s.colorMode ? "active" : ""} onClick={() => s.set({ colorMode: m.id })}>
              {t(lang, m.labelKey)}
            </button>
          ))}
        </div>
        {s.colorMode === "elevation" && s.zRange && (
          <div className="range2">
            <label>
              {t(lang, "color.minH")} <input type="number" step="0.5" value={s.zRange[0]} onChange={(e) => s.set({ zRange: [Number(e.target.value), s.zRange![1]] })} />
            </label>
            <label>
              {t(lang, "color.maxH")} <input type="number" step="0.5" value={s.zRange[1]} onChange={(e) => s.set({ zRange: [s.zRange![0], Number(e.target.value)] })} />
            </label>
            <div className="legend turbo" />
          </div>
        )}
        {s.colorMode === "change" && (
          <div>
            <label className="row">
              {t(lang, "color.range")} <input type="range" min={0.01} max={0.5} step={0.005} value={s.dzRange} onChange={(e) => s.set({ dzRange: Number(e.target.value) })} />
              <span className="mono">{dzMm} mm</span>
            </label>
            <div className="legend diverging" />
            <div className="row small muted spread">
              <span>{t(lang, "color.lower", { mm: dzMm })}</span>
              <span>{t(lang, "color.higher", { mm: dzMm })}</span>
            </div>
            {!hasDz && <div className="warn small">{t(lang, "color.noDz")}</div>}
          </div>
        )}
      </section>
      <section>
        <h3>{t(lang, "render.heading")}</h3>
        <label className="row">
          {t(lang, "render.pointBudget")}
          <input type="range" min={250_000} max={10_000_000} step={250_000} value={s.pointBudget} onChange={(e) => s.set({ pointBudget: Number(e.target.value) })} />
          <span className="mono">{(s.pointBudget / 1e6).toFixed(2)} M</span>
        </label>
        <label className="row">
          {t(lang, "render.pointSize")}
          <input type="range" min={0.5} max={4} step={0.1} value={s.pointSize} onChange={(e) => s.set({ pointSize: Number(e.target.value) })} />
          <span className="mono">{s.pointSize.toFixed(1)}</span>
        </label>
        <label className="row check">
          <input type="checkbox" checked={s.sizeMode === "adaptive"} onChange={(e) => s.set({ sizeMode: e.target.checked ? "adaptive" : "fixed" })} />
          {t(lang, "render.adaptive")}
        </label>
        <label className="row check">
          <input type="checkbox" checked={s.edl} onChange={(e) => s.set({ edl: e.target.checked })} />
          {t(lang, "render.edl")}
        </label>
        <button className="ghost" onClick={() => getEngine()?.fitView()}>{t(lang, "render.resetView")}</button>
      </section>
    </aside>
  );
}

function UploadButton() {
  const project = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  if (!project || project.role === "viewer") return null;
  return (
    <label className="upload">
      {t(lang, "layers.upload")}
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
                if (job.status === "failed") {
                  const curLang = useStore.getState().lang;
                  const errCode = typeof job.result?.errorCode === "string" ? job.result.errorCode : undefined;
                  const errParams =
                    job.result?.errorParams && typeof job.result.errorParams === "object"
                      ? (job.result.errorParams as Record<string, unknown>)
                      : undefined;
                  const errObj = errCode ? new ApiError(500, job.error ?? errCode, errCode, errParams) : (job.error ?? "");
                  set({ error: t(curLang, "layers.ingestFailed", { detail: localizeError(errObj, curLang) }) });
                }
                break;
              }
            }
            set({ datasets: await api.datasets(project.id) });
          } catch (err) {
            const curLang = useStore.getState().lang;
            set({ error: localizeError(err, curLang) });
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
  const lang = useStore((s) => s.lang);
  if (!stats) return null;
  return (
    <div className="hud mono" aria-label={t(lang, "hud.aria")}>
      <div><b>{stats.fps.toFixed(0)}</b> {t(lang, "hud.fps")}</div>
      <div>{t(lang, "hud.pts", { vis: (stats.visiblePoints / 1e6).toFixed(2), bud: (budget / 1e6).toFixed(1) })}</div>
      <div>{t(lang, "hud.nodes", { nodes: formatNumber(stats.visibleNodes, lang), pending: formatNumber(stats.pending, lang) })}</div>
      <div>{t(lang, "hud.gpu", { mb: stats.gpuMB.toFixed(0) })}</div>
    </div>
  );
}

export function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const err = useStore((s) => s.error);
  const lang = useStore((s) => s.lang);
  const set = useStore((s) => s.set);
  const j = cursor ? toJgd(cursor.position) : null;
  return (
    <footer className="statusbar mono">
      {j ? (
        <span>
          {t(lang, "status.coords", { x: j.X.toFixed(4), y: j.Y.toFixed(4), h: j.H.toFixed(4) })}
          {cursor?.dz !== undefined && t(lang, "status.dz", { mm: (cursor.dz * 1000).toFixed(1) })}
        </span>
      ) : (
        <span className="muted">{t(lang, "status.idle")}</span>
      )}
      {err && (
        <span className="error" onClick={() => set({ error: null })} title={t(lang, "status.dismiss")}>
          {err} ✕
        </span>
      )}
    </footer>
  );
}

// ------------------------------------------------------------------ measurements
function rows(m: MeasurementItem, lang: Lang): [string, string][] {
  const p = m.points;
  if (m.kind === "distance" && p.length === 2) {
    const r = measure(p[0]!, p[1]!);
    return [
      [t(lang, "meas.row.dist3d"), formatLength(r.distance3d)],
      [t(lang, "meas.row.horiz"), formatLength(r.horizontal)],
      [t(lang, "meas.row.dx"), formatDelta(r.dN)],
      [t(lang, "meas.row.dy"), formatDelta(r.dE)],
      [t(lang, "meas.row.dh"), formatDelta(r.dH)],
      [t(lang, "meas.row.grade"), formatGradePercent(r.slopePercent, lang)],
      [t(lang, "meas.row.angle"), formatGradeDegrees(r.slopeDegrees, lang)],
    ];
  }
  if (m.kind === "polyline") {
    return [
      [t(lang, "meas.row.len3d"), formatLength(polylineLength(p))],
      [t(lang, "meas.row.len2d"), formatLength(polylineLength(p.map((q) => [q[0], q[1], 0] as const)))],
      [t(lang, "meas.row.vertices"), String(p.length)],
    ];
  }
  if (m.kind === "area") {
    return [
      [t(lang, "meas.row.planArea"), formatArea(polygonArea(p.map((q) => [q[0], q[1]] as const)))],
      [t(lang, "meas.row.perim2d"), formatLength(polylineLength([...p, p[0]!].map((q) => [q[0], q[1], 0] as const)))],
      [t(lang, "meas.row.vertices"), String(p.length)],
    ];
  }
  const j = toJgd(p[0]!);
  return [
    [t(lang, "meas.row.dx").replace("ΔX", "X"), j.X.toFixed(4)],
    [t(lang, "meas.row.dy").replace("ΔY", "Y"), j.Y.toFixed(4)],
    [t(lang, "meas.row.h"), j.H.toFixed(4)],
  ];
}

function toCsv(ms: MeasurementItem[], lang: Lang): string {
  const head = "id,kind,label,vertex,X_north,Y_east,H,result";
  const lines = ms.flatMap((m) =>
    m.points.map((p, i) => {
      const j = toJgd(p);
      const res = i === 0 ? rows(m, lang).map(([k, v]) => `${k}=${v}`).join("; ") : "";
      return [m.id, m.kind, JSON.stringify(m.label), i + 1, j.X.toFixed(4), j.Y.toFixed(4), j.H.toFixed(4), JSON.stringify(res)].join(",");
    }),
  );
  return [head, ...lines].join("\n");
}

function kindLabel(kind: MeasurementItem["kind"], lang: Lang): string {
  switch (kind) {
    case "point": return t(lang, "meas.kind.point");
    case "distance": return t(lang, "meas.kind.distance");
    case "polyline": return t(lang, "meas.kind.polyline");
    case "area": return t(lang, "meas.kind.area");
  }
}

export function MeasurementPanel() {
  const { lang, measurements, selectedId, project, set, update, remove, lastPick } = useStore(
    useShallow((s) => ({
      lang: s.lang,
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
    try {
      const server = await api.measure(m.kind, m.points);
      const local: Record<string, number | null> =
        m.kind === "distance" ? { ...measure(m.points[0]!, m.points[1]!) } : m.kind === "polyline" ? { length3d: polylineLength(m.points) } : {};
      let worst = 0;
      for (const [k, v] of Object.entries(local)) {
        const sv = server[k];
        if (typeof v === "number" && typeof sv === "number" && !k.startsWith("slope")) worst = Math.max(worst, Math.abs(v - sv));
      }
      update(m.id, { serverCheck: { maxDiffMm: worst * 1000 } });
    } catch (err) {
      set({ error: localizeError(err, useStore.getState().lang) });
    }
  };

  return (
    <>
      <section>
        <h3>{t(lang, "pick.heading")}</h3>
        {lastPick ? (
          <table className="kv mono">
            <tbody>
              <tr><td>{t(lang, "pick.xNorth")}</td><td>{lastPick.position[1].toFixed(4)}</td></tr>
              <tr><td>{t(lang, "pick.yEast")}</td><td>{lastPick.position[0].toFixed(4)}</td></tr>
              <tr><td>{t(lang, "pick.h")}</td><td>{lastPick.position[2].toFixed(4)}</td></tr>
              {lastPick.geo && (
                <>
                  <tr><td>{t(lang, "pick.lat")}</td><td>{lastPick.geo.lat.toFixed(9)}°</td></tr>
                  <tr><td>{t(lang, "pick.lon")}</td><td>{lastPick.geo.lon.toFixed(9)}°</td></tr>
                  <tr><td>{t(lang, "pick.ellipsoid")}</td><td>{lastPick.geo.h.toFixed(4)}</td></tr>
                  <tr>
                    <td>{t(lang, "pick.geoid", { model: lastPick.geo.model.toUpperCase() })}</td>
                    <td>{lastPick.geo.N.toFixed(4)}{lastPick.geo.approximate ? t(lang, "pick.approx") : ""}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        ) : (
          <div className="muted small">{t(lang, "pick.empty")}</div>
        )}
      </section>
      <section>
        <div className="row spread">
          <h3>{t(lang, "meas.heading")}</h3>
          {measurements.length > 0 && (
            <button
              className="ghost small"
              onClick={() => downloadCsv("measurements.csv", toCsv(measurements, lang))}
            >
              {t(lang, "meas.csv")}
            </button>
          )}
        </div>
        {measurements.length === 0 && <div className="muted small">{t(lang, "meas.empty")}</div>}
        <ul className="mlist">
          {measurements.map((m) => (
            <li key={m.id} className={m.id === selectedId ? "sel" : ""} onClick={() => set({ selectedId: m.id })}>
              <span className="tag">{kindLabel(m.kind, lang)}</span>
              <span className="mono grow">{m.label || measurementLabel(m, lang)}</span>
              {m.savedId && <span title={t(lang, "meas.savedTitle")}>●</span>}
            </li>
          ))}
        </ul>
        {sel && (
          <div className="detail">
            <table className="kv mono">
              <tbody>
                {rows(sel, lang).map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="row wrap">
              <button className="ghost small" onClick={() => getEngine()?.lookAt(sel.points[0]!, 30)}>{t(lang, "meas.zoomTo")}</button>
              <button className="ghost small" onClick={() => crossCheck(sel)}>{t(lang, "meas.crossCheck")}</button>
              {canWrite && !sel.savedId && (
                <button
                  className="ghost small"
                  onClick={async () => {
                    try {
                      const saved = await api.saveMeasurement(project!.id, { kind: sel.kind, label: sel.label, points: sel.points });
                      update(sel.id, { savedId: saved.id });
                    } catch (err) {
                      set({ error: localizeError(err, useStore.getState().lang) });
                    }
                  }}
                >
                  {t(lang, "meas.save")}
                </button>
              )}
              <button
                className="ghost small danger"
                onClick={async () => {
                  try {
                    if (sel.savedId && project) await api.deleteMeasurement(project.id, sel.savedId);
                    remove(sel.id);
                  } catch (err) {
                    set({ error: localizeError(err, useStore.getState().lang) });
                  }
                }}
              >
                {t(lang, "meas.delete")}
              </button>
            </div>
            {sel.serverCheck && (
              <div className={`small ${sel.serverCheck.maxDiffMm <= 0.1 ? "ok" : "warn"}`}>
                {t(lang, "meas.diff", { mm: sel.serverCheck.maxDiffMm.toExponential(2) })}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
