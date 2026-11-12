/**
 * Vector overlay in RTC space: measurement lines, markers, labels (CSS2D), section box, frustums.
 * Drawn on top of points (depthTest off) so measurements stay readable.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Vec3 } from "./types";

export interface OverlayItem {
  id: string;
  kind: "point" | "distance" | "polyline" | "area" | "section" | "polygon" | "frustum";
  points: Vec3[]; // absolute float64 [E, N, H]
  label?: string;
  color?: string;
  selected?: boolean;
  /** section: half width (m); frustum: apex + 4 far corners in points */
  width?: number;
}

export class Overlay {
  readonly group = new THREE.Group();
  private origin: Vec3 = [0, 0, 0];

  setOrigin(o: Vec3) {
    this.origin = o;
  }

  private v(p: Vec3): THREE.Vector3 {
    return new THREE.Vector3(p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]);
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
    }
  }

  set(items: OverlayItem[], pending: Vec3[]) {
    this.clear();
    for (const it of items) this.group.add(this.build(it));
    if (pending.length) this.group.add(this.build({ id: "pending", kind: "polyline", points: pending, color: "#ffd166" }));
  }

  private line(pts: THREE.Vector3[], color: string, dashed = false, closed = false): THREE.Line {
    const g = new THREE.BufferGeometry().setFromPoints(closed ? [...pts, pts[0]!] : pts);
    const m = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.25, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85 })
      : new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
    const l = new THREE.Line(g, m);
    if (dashed) l.computeLineDistances();
    l.renderOrder = 10;
    return l;
  }

  private markers(pts: THREE.Vector3[], color: string): THREE.Points {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.PointsMaterial({ color, size: 9, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true });
    const p = new THREE.Points(g, m);
    p.renderOrder = 11;
    return p;
  }

  private label(text: string, at: THREE.Vector3, cls = ""): CSS2DObject {
    const div = document.createElement("div");
    div.className = `m-label ${cls}`;
    div.textContent = text;
    const o = new CSS2DObject(div);
    o.position.copy(at);
    return o;
  }

  private build(it: OverlayItem): THREE.Group {
    const g = new THREE.Group();
    const color = it.color ?? (it.selected ? "#ffd166" : "#4cc9f0");
    const pts = it.points.map((p) => this.v(p));
    if (!pts.length) return g;
    switch (it.kind) {
      case "point":
        g.add(this.markers(pts, color));
        break;
      case "distance": {
        const [a, b] = [pts[0]!, pts[1] ?? pts[0]!];
        g.add(this.line([a, b], color), this.markers([a, b], color));
        // horizontal and vertical legs (survey triangle)
        const lowFirst = a.z <= b.z;
        const low = lowFirst ? a : b;
        const high = lowFirst ? b : a;
        const corner = new THREE.Vector3(high.x, high.y, low.z);
        g.add(this.line([low, corner], "#90be6d", true), this.line([corner, high], "#f9844a", true));
        break;
      }
      case "polyline":
        g.add(this.line(pts, color), this.markers(pts, color));
        break;
      case "area":
      case "polygon":
        g.add(this.line(pts, color, false, pts.length > 2), this.markers(pts, color));
        break;
      case "section": {
        const [a, b] = [pts[0]!, pts[1] ?? pts[0]!];
        const w = it.width ?? 1;
        const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, 0).normalize();
        const n = new THREE.Vector3(-dir.y, dir.x, 0).multiplyScalar(w);
        const z = Math.min(a.z, b.z);
        const ring = [a.clone().add(n), b.clone().add(n), b.clone().sub(n), a.clone().sub(n)].map((p) => p.setZ(z));
        g.add(this.line([a, b], color), this.line(ring, color, true, true), this.markers([a, b], color));
        break;
      }
      case "frustum": {
        const [apex, ...corners] = pts;
        for (const c of corners) g.add(this.line([apex!, c], color));
        if (corners.length === 4) g.add(this.line(corners, color, false, true));
        break;
      }
    }
    if (it.label) {
      const at = it.kind === "distance" || it.kind === "section"
        ? pts[0]!.clone().add(pts[1] ?? pts[0]!).multiplyScalar(0.5)
        : pts[pts.length - 1]!;
      g.add(this.label(it.label, at, it.selected ? "sel" : ""));
    }
    return g;
  }
}
