/** Pure helpers for the 2D CAD profile view (testable). */

export interface Scale {
  /** station (m) -> px */
  x: (s: number) => number;
  /** elevation (m) -> px (SVG y grows downward) */
  y: (z: number) => number;
  /** px -> station */
  invX: (px: number) => number;
  /** px -> elevation */
  invY: (py: number) => number;
  /** metres per px horizontally */
  mppX: number;
}

/**
 * Fit a station/elevation window into a w x h px box with a vertical exaggeration (VE).
 * At VE = 1 one metre has the same length on both axes (true CAD scale).
 */
export function fitScale(length: number, zMin: number, zMax: number, w: number, h: number, ve: number, pad = 36): Scale {
  const innerW = Math.max(10, w - 2 * pad);
  const innerH = Math.max(10, h - 2 * pad);
  const zSpan = Math.max(zMax - zMin, 0.01);
  // px per metre horizontally; vertical px per metre = k * ve. Fit both.
  const k = Math.min(innerW / Math.max(length, 0.01), innerH / (zSpan * ve));
  const zMid = (zMin + zMax) / 2;
  const x = (s: number) => pad + s * k;
  const y = (z: number) => pad + innerH / 2 - (z - zMid) * k * ve;
  return {
    x,
    y,
    invX: (px: number) => (px - pad) / k,
    invY: (py: number) => zMid - (py - pad - innerH / 2) / (k * ve),
    mppX: 1 / k,
  };
}

/** "Nice" grid step for an axis span (1, 2, 5 x 10^n) aiming at ~targetLines lines. */
export function niceStep(span: number, targetLines = 8): number {
  const raw = span / Math.max(targetLines, 1);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Interpolated ground elevation at station s (linear between bins). */
export function groundAt(ground: readonly (readonly [number, number])[], s: number): number | null {
  if (!ground.length) return null;
  if (s <= ground[0]![0]) return ground[0]![1];
  for (let i = 1; i < ground.length; i++) {
    const [s1, z1] = ground[i]!;
    if (s <= s1) {
      const [s0, z0] = ground[i - 1]!;
      return z0 + ((z1 - z0) * (s - s0)) / (s1 - s0 || 1);
    }
  }
  return ground[ground.length - 1]![1];
}
