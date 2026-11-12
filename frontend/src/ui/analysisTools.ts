/**
 * Hook points for analysis tools (section, volume, as-built). Filled in Phase 5; kept separate so
 * the viewer's measurement code stays small.
 */
import type { OverlayItem } from "../engine/Overlay";
import type { Vec3 } from "../engine/types";

export function handleAnalysisClick(_p: Vec3 | null): void {
  /* phase 5 */
}

export function extraOverlay(): OverlayItem[] {
  return [];
}
