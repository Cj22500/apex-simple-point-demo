/**
 * Survey measurements. Spec: docs/specs/measurement.md
 *
 * Frame: [E, N, H] metres (easting, northing, orthometric height), float64 (JS number).
 * In JGD2011 plane-rectangular terms E = Y (east) and N = X (north); see toJgd().
 */

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export interface Measurement {
  dE: number;
  dN: number;
  dH: number;
  /** Plan (2D) distance, m */
  horizontal: number;
  /** Slope (3D) distance, m */
  distance3d: number;
  /** Signed grade a→b in %, null when the pair is vertical or coincident */
  slopePercent: number | null;
  /** Signed grade a→b in degrees, null when the pair is vertical or coincident */
  slopeDegrees: number | null;
}

const RAD2DEG = 180 / Math.PI;

export function measure(a: Vec3, b: Vec3): Measurement {
  const dE = b[0] - a[0];
  const dN = b[1] - a[1];
  const dH = b[2] - a[2];
  const horizontal = Math.hypot(dE, dN);
  const distance3d = Math.hypot(dE, dN, dH);
  const hasGrade = horizontal > 0;
  return {
    dE,
    dN,
    dH,
    horizontal,
    distance3d,
    slopePercent: hasGrade ? (dH / horizontal) * 100 : null,
    slopeDegrees: hasGrade ? Math.atan2(dH, horizontal) * RAD2DEG : null,
  };
}

/** Sum of 3D segment lengths. */
export function polylineLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    total += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  }
  return total;
}

/**
 * Plan area of a simple polygon (shoelace), always positive.
 * Coordinates are shifted to the first vertex first: at Tokyo-scale coordinates (~35 km) the raw
 * cross products are ~1e9 m², and subtracting them would lose sub-mm² precision.
 */
export function polygonArea(points: readonly Vec2[]): number {
  const n = points.length;
  if (n < 3) return 0;
  const [x0, y0] = points[0]!;
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % n]!;
    twice += (p[0] - x0) * (q[1] - y0) - (q[0] - x0) * (p[1] - y0);
  }
  return Math.abs(twice) / 2;
}

/** Japanese plane-rectangular labels: X = north, Y = east. */
export function toJgd(p: Vec3): { X: number; Y: number; H: number } {
  return { X: p[1], Y: p[0], H: p[2] };
}
