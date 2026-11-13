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

export type FormatLang = "en" | "ja";

export function formatGradePercent(p: number | null, lang: FormatLang = "en"): string {
  return p === null ? (lang === "ja" ? "鉛直" : "vertical") : `${p.toFixed(3)} %`;
}

export function formatGradeDegrees(d: number | null, lang: FormatLang = "en"): string {
  return d === null ? (lang === "ja" ? "鉛直" : "vertical") : `${d.toFixed(4)}°`;
}

export function formatArea(m2: number): string {
  return `${m2.toFixed(4)} m²`;
}

export function formatVolume(m3: number): string {
  return `${m3.toFixed(3)} m³`;
}

/** Format a number with locale-specific grouping separators. */
export function formatNumber(value: number, lang: FormatLang = "en", opts?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(lang === "ja" ? "ja-JP" : "en-US", opts);
}

/** Format project CRS and vertical geoid model for display. */
export function formatProjectCrs(crs?: string, geoidModel?: string, lang: FormatLang = "en"): string {
  const geoid = (geoidModel || "jpgeo2024").toUpperCase();
  const norm = crs?.trim().toUpperCase();
  const isZone9 = !norm || norm === "EPSG:6677+EPSG:6695" || norm === "EPSG:6677+6695" || norm === "EPSG:6677";
  if (lang === "ja") {
    const horiz = isZone9 ? "平面直角座標系第IX系 JGD2011 (EPSG:6677)" : crs!.trim();
    return `${horiz} · ${geoid} 標高`;
  }
  const horiz = isZone9 ? "JGD2011 Zone IX (EPSG:6677)" : crs!.trim();
  return `${horiz} · ${geoid} heights`;
}

/** Trigger a browser CSV file download (with UTF-8 BOM for Excel Japanese compatibility) and revoke the temporary object URL. */
export function downloadCsv(filename: string, csv: string): void {
  const content = csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
