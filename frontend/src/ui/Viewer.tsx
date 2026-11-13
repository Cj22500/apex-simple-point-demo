import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import { PointCloudEngine } from "../engine/PointCloudEngine";
import type { OverlayItem } from "../engine/Overlay";
import type { Vec3 } from "../engine/types";
import { measure, polygonArea, polylineLength } from "../geo/measure";
import { formatArea, formatGradePercent, formatLength } from "../geo/format";
import { localizeError } from "../i18n";
import { newId, useStore, type MeasurementItem } from "../store";
import { setEngine } from "./engineRef";
import { extraOverlay, handleAnalysisClick, useAnalysis } from "./analysisTools";

export function measurementLabel(m: Pick<MeasurementItem, "kind" | "points">, lang: "en" | "ja" = "en"): string {
  const p = m.points;
  switch (m.kind) {
    case "distance": {
      if (p.length < 2) return "";
      const r = measure(p[0]!, p[1]!);
      return `${formatLength(r.distance3d)} · ${formatGradePercent(r.slopePercent, lang)}`;
    }
    case "polyline":
      return formatLength(polylineLength(p));
    case "area":
      return formatArea(polygonArea(p.map((q) => [q[0], q[1]] as const)));
    case "point":
      return p[0] ? `${lang === "ja" ? "標高" : "H"} ${p[0][2].toFixed(4)}` : "";
  }
}

export function Viewer() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<PointCloudEngine | null>(null);

  // engine lifecycle
  useEffect(() => {
    const e = new PointCloudEngine(host.current!, (id, name) => api.node(id, name));
    engine.current = e;
    setEngine(e);
    if (import.meta.env.DEV) (window as unknown as { __spl: unknown }).__spl = { engine: e, store: useStore, analysis: useAnalysis };
    const off = e.onStats((stats) => useStore.getState().set({ stats }));
    return () => {
      off();
      setEngine(null);
      e.dispose();
      engine.current = null;
    };
  }, []);

  // settings -> engine
  const settings = useStore(useShallow((s) => [s.colorMode, s.pointBudget, s.pointSize, s.sizeMode, s.edl, s.zRange, s.dzRange] as const));
  useEffect(() => {
    const [colorMode, pointBudget, pointSize, sizeMode, edl, zRange, dzRange] = settings;
    engine.current?.setSettings({ colorMode, pointBudget, pointSize, sizeMode, edl, zRange, dzRange });
  }, settings); // eslint-disable-line react-hooks/exhaustive-deps

  // datasets/visibility -> layers
  const datasets = useStore((s) => s.datasets);
  const visible = useStore((s) => s.visible);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    let cancelled = false;
    const datasetIds = new Set(datasets.map((d) => d.id));
    for (const id of e.layerIds()) {
      // keep local-* offline layers managed by OfflinePanel
      if (!id.startsWith("local-") && !datasetIds.has(id)) e.removeLayer(id);
    }
    (async () => {
      for (const d of datasets) {
        if (d.status !== "ready") continue;
        const want = visible[d.id] ?? false;
        if (want && !e.hasLayer(d.id)) {
          const h = await api.hierarchy(d.id);
          if (cancelled) return;
          if (!e.hasLayer(d.id)) {
            e.addLayer(d.id, h);
            const st = useStore.getState();
            if (!st.zRange) st.set({ zRange: e.settings.zRange });
          }
        }
        e.setLayerVisible(d.id, want);
      }
    })().catch((err) => useStore.getState().set({ error: localizeError(err, useStore.getState().lang) }));
    return () => {
      cancelled = true;
    };
  }, [datasets, visible]);

  // measurements + analysis overlays -> engine overlay
  const measurements = useStore((s) => s.measurements);
  const selectedId = useStore((s) => s.selectedId);
  const pending = useStore((s) => s.pending);
  const tool = useStore((s) => s.tool);
  const analysis = useStore((s) => s.analysisVersion);
  const lang = useStore((s) => s.lang);
  useEffect(() => {
    const items: OverlayItem[] = measurements.map((m) => ({
      id: m.id,
      kind: m.kind,
      points: m.points,
      label: m.label || measurementLabel(m, lang),
      selected: m.id === selectedId,
    }));
    engine.current?.setOverlay([...items, ...extraOverlay()], pending);
  }, [measurements, selectedId, pending, tool, analysis, lang]);

  // pointer handling: click = tool action, move = cursor readout, dblclick = orbit target
  useEffect(() => {
    const el = host.current!;
    let down: { x: number; y: number } | null = null;
    let lastMove = 0;
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY };
    };
    const onUp = (ev: PointerEvent) => {
      if (!down || ev.button !== 0) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      down = null;
      if (moved > 4) return;
      const e = engine.current;
      const hit = e?.pick(ev.clientX, ev.clientY);
      if (!hit) return;
      onPick(hit.position);
      useStore.getState().set({ lastPick: hit });
      api
        .planeToGeographic(hit.position[1], hit.position[0], hit.position[2])
        .then((r) => {
          const g = r.points[0]!;
          const cur = useStore.getState().lastPick;
          if (cur && cur.position === hit.position)
            useStore.getState().set({ lastPick: { ...cur, geo: { ...g, model: r.geoid.model, approximate: r.geoid.approximate } } });
        })
        .catch(() => undefined);
    };
    const onMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (down || now - lastMove < 60) return;
      lastMove = now;
      const hit = engine.current?.pick(ev.clientX, ev.clientY, 4) ?? null;
      useStore.getState().set({ cursor: hit });
    };
    const onDbl = (ev: MouseEvent) => {
      const { tool, pending } = useStore.getState();
      if ((tool === "polyline" || tool === "area" || tool === "volume") && pending.length >= 2) {
        finish();
        return;
      }
      if (tool !== "navigate") return;
      const hit = engine.current?.pick(ev.clientX, ev.clientY);
      if (hit) engine.current?.lookAt(hit.position, 30);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.key === "Escape") useStore.getState().set({ pending: [] });
      if (ev.key === "Enter") finish();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("dblclick", onDbl);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("dblclick", onDbl);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return <div className="viewer" ref={host} data-tool={tool} />;
}

function onPick(p: Vec3) {
  const s = useStore.getState();
  switch (s.tool) {
    case "point":
      s.addMeasurement({ id: newId(), kind: "point", label: "", points: [p] });
      break;
    case "distance":
      if (s.pending.length === 0) s.set({ pending: [p] });
      else s.addMeasurement({ id: newId(), kind: "distance", label: "", points: [s.pending[0]!, p] });
      break;
    case "polyline":
    case "area":
      s.set({ pending: [...s.pending, p] });
      break;
    default:
      handleAnalysisClick(p);
  }
}

function finish() {
  const s = useStore.getState();
  if ((s.tool === "polyline" || s.tool === "area") && s.pending.length >= 2) {
    // a double-click adds the same point twice; drop exact duplicates
    const pts = s.pending.filter((p, i, a) => i === 0 || p !== a[i - 1]);
    if (s.tool === "area" && pts.length < 3) return;
    s.addMeasurement({ id: newId(), kind: s.tool, label: "", points: pts });
  } else {
    handleAnalysisClick(null);
  }
}
