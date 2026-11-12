/** Types mirroring backend/app/core/octree.py (format "spl-octree-1"). */
export type Vec3 = [number, number, number];

export interface HierarchyNode {
  name: string;
  level: number;
  count: number;
  min: Vec3;
  max: Vec3;
  /** float64 node centre: points are float32 offsets from here */
  center: Vec3;
  spacing: number;
  leaf: boolean;
  children: number[];
}

export interface Hierarchy {
  format: "spl-octree-1";
  crs: string;
  points: number;
  cube: { min: Vec3; size: number };
  bounds: { min: Vec3; max: Vec3 };
  grid: number;
  attributes: { extras: string[] };
  stats: Record<string, number>;
  nodes: HierarchyNode[];
}

export interface DecodedNode {
  count: number;
  /** float32 offsets from node centre, xyz interleaved */
  position: Float32Array;
  index: Uint32Array;
  intensity: Uint16Array;
  rgb: Uint8Array;
  classification: Uint8Array;
  extras: Record<string, Float32Array>;
}
