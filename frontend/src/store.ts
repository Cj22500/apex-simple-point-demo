/** App state (zustand). The engine reads settings from here; tools write measurements here. */
import { create } from "zustand";
import type { Dataset, Project } from "./api/client";
import type { ColorMode, EngineStats, PickHit } from "./engine/PointCloudEngine";
import type { Vec3 } from "./engine/types";

export type Tool = "navigate" | "point" | "distance" | "polyline" | "area" | "section" | "volume" | "asbuilt";

export interface MeasurementItem {
  id: string;
  kind: "point" | "distance" | "polyline" | "area";
  label: string;
  points: Vec3[];
  savedId?: string;
  serverCheck?: { maxDiffMm: number };
}

export interface Geo {
  lat: number;
  lon: number;
  h: number;
  N: number;
  model: string;
  approximate: boolean;
}

interface State {
  user: { name: string; email: string } | null;
  project: Project | null;
  datasets: Dataset[];
  visible: Record<string, boolean>;
  error: string | null;

  colorMode: ColorMode;
  pointBudget: number;
  pointSize: number;
  sizeMode: "fixed" | "adaptive";
  edl: boolean;
  zRange: [number, number] | null;
  dzRange: number;

  tool: Tool;
  pending: Vec3[];
  measurements: MeasurementItem[];
  selectedId: string | null;

  stats: EngineStats | null;
  cursor: PickHit | null;
  lastPick: (PickHit & { geo?: Geo }) | null;
  /** bumped when analysis overlays (sections, volume polygons...) change */
  analysisVersion: number;

  set: (patch: Partial<State>) => void;
  setTool: (t: Tool) => void;
  addMeasurement: (m: MeasurementItem) => void;
  updateMeasurement: (id: string, patch: Partial<MeasurementItem>) => void;
  removeMeasurement: (id: string) => void;
}

export const useStore = create<State>((set) => ({
  user: null,
  project: null,
  datasets: [],
  visible: {},
  error: null,

  colorMode: "rgb",
  pointBudget: 2_000_000,
  pointSize: 1.8,
  sizeMode: "adaptive",
  edl: true,
  zRange: null,
  dzRange: 0.05,

  tool: "navigate",
  pending: [],
  measurements: [],
  selectedId: null,

  stats: null,
  cursor: null,
  lastPick: null,
  analysisVersion: 0,

  set: (patch) => set(patch),
  setTool: (tool) => set({ tool, pending: [] }),
  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, m], selectedId: m.id, pending: [] })),
  updateMeasurement: (id, patch) =>
    set((s) => ({ measurements: s.measurements.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  removeMeasurement: (id) =>
    set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id), selectedId: s.selectedId === id ? null : s.selectedId })),
}));

let counter = 0;
export const newId = (prefix = "m") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;
