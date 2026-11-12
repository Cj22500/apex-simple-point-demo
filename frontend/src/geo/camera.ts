/**
 * Pinhole camera pose maths, mirroring backend/app/core/photos.py (same conventions and tests).
 * World [E, N, H]; camera OpenCV frame (x right, y down, z forward); yaw clockwise from north,
 * pitch -90 = nadir.
 */
import type { Vec3 } from "./measure";

export interface PhotoPose {
  E: number;
  N: number;
  H: number;
  yaw: number;
  pitch: number;
  roll: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** World -> camera rotation rows [right, down, forward]. */
export function rotationRows(p: PhotoPose): [Vec3, Vec3, Vec3] {
  const y = rad(p.yaw), t = rad(p.pitch), r = rad(p.roll);
  const heading: Vec3 = [Math.sin(y), Math.cos(y), 0];
  const right0: Vec3 = [Math.cos(y), -Math.sin(y), 0];
  const fwd: Vec3 = [Math.cos(t) * heading[0], Math.cos(t) * heading[1], Math.sin(t)];
  const up0 = cross(right0, fwd);
  const c = Math.cos(r), s = Math.sin(r);
  const right: Vec3 = [c * right0[0] - s * up0[0], c * right0[1] - s * up0[1], c * right0[2] - s * up0[2]];
  const up: Vec3 = [s * right0[0] + c * up0[0], s * right0[1] + c * up0[1], s * right0[2] + c * up0[2]];
  return [right, [-up[0], -up[1], -up[2]], fwd];
}

/** World point -> pixel (u, v) and depth along the optical axis. */
export function projectPoint(p: PhotoPose, w: Vec3): { u: number; v: number; depth: number } {
  const [r, d, f] = rotationRows(p);
  const q: Vec3 = [w[0] - p.E, w[1] - p.N, w[2] - p.H];
  const x = r[0] * q[0] + r[1] * q[1] + r[2] * q[2];
  const y = d[0] * q[0] + d[1] * q[1] + d[2] * q[2];
  const z = f[0] * q[0] + f[1] * q[1] + f[2] * q[2];
  return { u: (p.fx * x) / z + p.cx, v: (p.fy * y) / z + p.cy, depth: z };
}

/** Vertical field of view (degrees) for a centred principal point. */
export function verticalFov(p: PhotoPose): number {
  return (2 * Math.atan(p.height / 2 / p.fy) * 180) / Math.PI;
}
