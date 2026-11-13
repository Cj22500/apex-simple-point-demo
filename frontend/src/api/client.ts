/** Typed client for the FastAPI backend (proxied at /api by Vite). */
import type { Hierarchy, Vec3 } from "../engine/types";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

let token = "";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await res.json()) as T;
  if (type.includes("octet-stream")) return (await res.arrayBuffer()) as T;
  return (await res.blob()) as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export interface Project {
  id: string;
  name: string;
  crs: string;
  geoidModel: string;
  role: "owner" | "editor" | "viewer";
}

export interface Dataset {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  epoch: string | null;
  sourceFormat: string;
  status: "processing" | "ready" | "failed";
  pointCount: number;
  meta: Record<string, any>;
}

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  error: string | null;
  result: Record<string, any>;
  datasetId: string | null;
}

export interface SavedMeasurement {
  id: string;
  kind: "point" | "distance" | "polyline" | "area";
  label: string;
  points: Vec3[];
  result: Record<string, number | null>;
}

export const api = {
  async login(email = "demo@example.com") {
    const r = await req<{ token: string; user: { id: string; name: string; email: string } }>(
      `/auth/dev-token?email=${encodeURIComponent(email)}`,
      { method: "POST" },
    );
    token = r.token;
    return r.user;
  },
  projects: () => req<Project[]>("/projects"),
  datasets: (projectId: string) => req<Dataset[]>(`/projects/${projectId}/datasets`),
  dataset: (id: string) => req<Dataset>(`/datasets/${id}`),
  hierarchy: (id: string) => req<Hierarchy>(`/datasets/${id}/hierarchy`),
  node: (id: string, name: string) => req<ArrayBuffer>(`/datasets/${id}/nodes/${name}.bin`),
  job: (id: string) => req<Job>(`/jobs/${id}`),
  upload(projectId: string, file: File, name: string) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name);
    return req<{ datasetId: string; jobId: string }>(`/projects/${projectId}/datasets`, { method: "POST", body: fd });
  },
  measure: (kind: string, points: Vec3[]) => req<Record<string, number | null>>("/measure", json({ kind, points })),
  listMeasurements: (projectId: string) => req<SavedMeasurement[]>(`/projects/${projectId}/measurements`),
  saveMeasurement: (projectId: string, m: { kind: string; label: string; points: Vec3[]; datasetId?: string }) =>
    req<SavedMeasurement>(`/projects/${projectId}/measurements`, json(m)),
  deleteMeasurement: (projectId: string, id: string) =>
    req<unknown>(`/projects/${projectId}/measurements/${id}`, { method: "DELETE" }),
  planeToGeographic: (X: number, Y: number, H: number) =>
    req<{ geoid: { model: string; approximate: boolean; note: string }; points: { lat: number; lon: number; h: number; H: number; N: number }[] }>(
      "/crs/transform",
      json({ direction: "plane_to_geographic", heightType: "orthometric", points: [[X, Y, H]] }),
    ),
  /** generic POST helper for analysis endpoints added in later phases */
  post: <T>(path: string, body: unknown) => req<T>(path, json(body)),
  get: <T>(path: string) => req<T>(path),
  del: (path: string) => req<unknown>(path, { method: "DELETE" }),
  uploadFile<T>(path: string, file: File): Promise<T> {
    const fd = new FormData();
    fd.append("file", file);
    return req<T>(path, { method: "POST", body: fd });
  },
  /** authenticated download (DXF/SIMA/LAS/CSV/GeoTIFF) -> triggers a browser save */
  async download(path: string, filename: string, body?: unknown) {
    const blob = await req<Blob>(path, body === undefined ? {} : json(body));
    const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob as BlobPart]));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  get token() {
    return token;
  },
};
