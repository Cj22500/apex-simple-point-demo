/** Display formatting rules from docs/specs/measurement.md. */

/** Metres with 4 decimals (0.1 mm). */
export function formatLength(m: number): string {
  return `${m.toFixed(4)} m`;
}

/** Signed metres with 4 decimals. */
export function formatDelta(m: number): string {
  const s = m.toFixed(4);
  return `${m >= 0 && !s.startsWith("-") ? "+" : ""}${s} m`;
}

export function formatGradePercent(p: number | null): string {
  return p === null ? "vertical" : `${p.toFixed(3)} %`;
}

export function formatGradeDegrees(d: number | null): string {
  return d === null ? "vertical" : `${d.toFixed(4)}°`;
}

export function formatArea(m2: number): string {
  return `${m2.toFixed(4)} m²`;
}

export function formatVolume(m3: number): string {
  return `${m3.toFixed(3)} m³`;
}
