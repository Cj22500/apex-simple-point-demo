/**
 * Analysis tool state + click handling (section, volume polygon) and their overlays.
 */
import { create } from "zustand";
import { api, type Job } from "../api/client";
import type { OverlayItem } from "../engine/Overlay";
import type { Vec3 } from "../engine/types";
import { useStore } from "../store";
import { getEngine } from "./engineRef";
import { usePhotos } from "./photoStore";

export interface ProfileData {
  length: number;
  pointCount: number;
  points: [number, number, number][]; // station, offset, z
  ground: [number, number][];
  zMin: number | null;
  zMax: number | null;
}

export interface Section {
  a: Vec3;
  b: Vec3;
  halfWidth: number;
}

export interface ControlPoint {
  number: number;
  name: string;
  E: number;
  N: number;
  H: number;
}

interface AnalysisState {
  section: Section | null;
  profile: ProfileData | null;
  profileLoading: boolean;
  clip: "off" | "highlight" | "slab";
  profileCursor: number | null; // station
  volumePolygon: Vec3[] | null;
  controlPoints: ControlPoint[];
  showControlPoints: boolean;
  busy: Record<string, string>; // task -> status text
  set: (p: Partial<AnalysisState>) => void;
}

export const useAnalysis = create<AnalysisState>((set) => ({
  section: null,
  profile: null,
  profileLoading: false,
  clip: "highlight",
  profileCursor: null,
  volumePolygon: null,
  controlPoints: [],
  showControlPoints: true,
  busy: {},
  set: (p) => {
    set(p);
    useStore.getState().set({ analysisVersion: useStore.getState().analysisVersion + 1 });
  },
}));

/** Dataset the analysis tools operate on: the top-most visible, ready dataset. */
export function activeDataset() {
  const { datasets, visible } = useStore.getState();
  const vis = datasets.filter((d) => visible[d.id] && d.status === "ready");
  return vis[vis.length - 1] ?? null;
}

export function applyClip() {
  const { section, clip } = useAnalysis.getState();
  getEngine()?.setClip(section && clip !== "off" ? { a: section.a, b: section.b, halfWidth: section.halfWidth, mode: clip } : null);
}

export async function loadProfile() {
  const { section, set } = useAnalysis.getState();
  const ds = activeDataset();
  if (!section || !ds) return;
  set({ profileLoading: true });
  try {
    const profile = await api.post<ProfileData>(`/datasets/${ds.id}/profile`, {
      a: section.a.slice(0, 2),
      b: section.b.slice(0, 2),
      halfWidth: section.halfWidth,
      binSize: 0.1,
    });
    set({ profile, profileLoading: false });
  } catch (err) {
    set({ profileLoading: false });
    useStore.getState().set({ error: String(err) });
  }
}

export function handleAnalysisClick(p: Vec3 | null): void {
  const s = useStore.getState();
  const a = useAnalysis.getState();
  if (s.tool === "section" && p) {
    if (s.pending.length === 0) s.set({ pending: [p] });
    else {
      a.set({ section: { a: s.pending[0]!, b: p, halfWidth: a.section?.halfWidth ?? 0.5 }, profileCursor: null });
      s.set({ pending: [] });
      applyClip();
      void loadProfile();
    }
  } else if (s.tool === "volume") {
    if (p) s.set({ pending: [...s.pending, p] });
    else if (s.pending.length >= 3) {
      a.set({ volumePolygon: s.pending.filter((q, i, arr) => i === 0 || q !== arr[i - 1]) });
      s.set({ pending: [] });
    }
  }
}

export function extraOverlay(): OverlayItem[] {
  const { section, volumePolygon, controlPoints, showControlPoints, profileCursor } = useAnalysis.getState();
  const items: OverlayItem[] = [];
  if (section) {
    items.push({ id: "section", kind: "section", points: [section.a, section.b], width: section.halfWidth, color: "#f72585", label: "SEC-1" });
    if (profileCursor !== null) {
      const t = profileCursor / Math.hypot(section.b[0] - section.a[0], section.b[1] - section.a[1]);
      const p: Vec3 = [
        section.a[0] + (section.b[0] - section.a[0]) * t,
        section.a[1] + (section.b[1] - section.a[1]) * t,
        section.a[2] + (section.b[2] - section.a[2]) * t,
      ];
      items.push({ id: "cursor", kind: "point", points: [p], color: "#f72585" });
    }
  }
  if (volumePolygon) items.push({ id: "vol", kind: "polygon", points: volumePolygon, color: "#ffd166", label: "volume" });
  const ph = usePhotos.getState();
  if (ph.showFrustums) {
    for (const p of ph.photos) {
      const sel = ph.active?.id === p.id;
      items.push({ id: `ph${p.id}`, kind: "frustum", points: [p.center, ...p.frustum], color: sel ? "#ffd166" : "#f8961e", label: sel ? p.filename : undefined });
    }
  }
  if (showControlPoints) {
    for (const c of controlPoints) items.push({ id: `cp${c.number}`, kind: "point", points: [[c.E, c.N, c.H]], color: "#ef476f", label: c.name });
  }
  return items;
}

/** Poll a job until done; refresh datasets; optionally show the new dataset instead of its parent. */
export async function waitForJob(jobId: string, task: string, showDataset?: { id: string; hide?: string[] }): Promise<Job> {
  const a = useAnalysis.getState();
  for (;;) {
    const job = await api.job(jobId);
    a.set({ busy: { ...useAnalysis.getState().busy, [task]: `${job.status} ${(job.progress * 100).toFixed(0)}%` } });
    if (job.status === "done" || job.status === "failed") {
      const busy = { ...useAnalysis.getState().busy };
      delete busy[task];
      a.set({ busy });
      const st = useStore.getState();
      const datasets = await api.datasets(st.project!.id);
      const visible = { ...st.visible };
      if (job.status === "done" && showDataset) {
        visible[showDataset.id] = true;
        for (const h of showDataset.hide ?? []) visible[h] = false;
      }
      st.set({ datasets, visible });
      if (job.status === "failed") st.set({ error: `${task} failed: ${job.error}` });
      return job;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}
