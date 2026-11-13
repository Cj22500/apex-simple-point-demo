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

/** Format project CRS and vertical geoid model for display. */
export function formatProjectCrs(crs?: string, geoidModel?: string): string {
  const geoid = (geoidModel || "jpgeo2024").toUpperCase();
  const norm = crs?.trim().toUpperCase();
  const horiz =
    !norm || norm === "EPSG:6677+EPSG:6695" || norm === "EPSG:6677+6695" || norm === "EPSG:6677"
      ? "JGD2011 Zone IX (EPSG:6677)"
      : crs!.trim();
  return `${horiz} · ${geoid} heights`;
}

/** Trigger a browser CSV file download and revoke the temporary object URL. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
