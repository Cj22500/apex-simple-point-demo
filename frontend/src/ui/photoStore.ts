import { create } from "zustand";
import type { PhotoPose } from "../geo/camera";
import type { Vec3 } from "../engine/types";
import { useStore } from "../store";

export interface Photo {
  id: string;
  filename: string;
  pose: PhotoPose & { lat: number; lon: number; h: number; geoid_model: string };
  frustum: Vec3[];
  center: Vec3;
}

export interface Seeing {
  id: string;
  filename: string;
  u: number;
  v: number;
  distance: number;
}

interface PhotoState {
  photos: Photo[];
  showFrustums: boolean;
  active: { id: string; marker?: { u: number; v: number } } | null;
  opacity: number;
  seeing: Seeing[];
  splat: { status: "off" | "loading" | "on"; count: number; showPoints: boolean };
  set: (p: Partial<PhotoState>) => void;
}

export const usePhotos = create<PhotoState>((set) => ({
  photos: [],
  showFrustums: true,
  active: null,
  opacity: 0.6,
  seeing: [],
  splat: { status: "off", count: 0, showPoints: true },
  set: (p) => {
    set(p);
    useStore.getState().set({ analysisVersion: useStore.getState().analysisVersion + 1 });
  },
}));
