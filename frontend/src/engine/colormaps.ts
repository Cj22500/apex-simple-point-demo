/** Colormaps as 256-entry RGB tables (uploaded to the GPU as 1D textures). */

type Stop = [number, number, number, number]; // t, r, g, b (0..1)

function fromStops(stops: Stop[]): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1]![0]) k++;
    const [t0, r0, g0, b0] = stops[k]!;
    const [t1, r1, g1, b1] = stops[k + 1]!;
    const u = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    out[i * 4] = Math.round(255 * (r0 + (r1 - r0) * u));
    out[i * 4 + 1] = Math.round(255 * (g0 + (g1 - g0) * u));
    out[i * 4 + 2] = Math.round(255 * (b0 + (b1 - b0) * u));
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Turbo (Google, Apache-2.0) polynomial approximation: perceptually smooth rainbow for elevation. */
export function turbo(): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
    const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
    const b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
    out[i * 4] = Math.round(255 * Math.min(1, Math.max(0, r)));
    out[i * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, g)));
    out[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, b)));
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Diverging blue–white–red for ΔZ (negative = settlement/removal in blue, positive = fill in red). */
export function diverging(): Uint8Array {
  return fromStops([
    [0, 0.019, 0.188, 0.38],
    [0.25, 0.263, 0.576, 0.765],
    [0.5, 0.97, 0.97, 0.97],
    [0.75, 0.839, 0.376, 0.302],
    [1, 0.404, 0, 0.122],
  ]);
}

/** ASPRS classification palette (subset). */
export const CLASS_COLORS: Record<number, [number, number, number]> = {
  0: [180, 180, 180],
  1: [200, 200, 200], // unclassified
  2: [166, 124, 82], // ground
  3: [120, 200, 90], // low vegetation
  5: [40, 140, 40], // high vegetation
  6: [230, 90, 70], // building
  7: [255, 0, 255], // low noise
  9: [70, 130, 230], // water
};

/** Map a value to [0,1] for a symmetric diverging scale. */
export function divergingT(value: number, range: number): number {
  return Math.min(1, Math.max(0, 0.5 + value / (2 * range)));
}
