/**
 * One streamed point cloud dataset: octree nodes -> THREE.Points, LOD selection, LRU unloading.
 */
import * as THREE from "three";
import { decodeNode } from "./decode";
import { selectNodes, type LodNode, type LodView } from "./lod";
import { pointFragment, pointVertex } from "./shaders";
import type { DecodedNode, Hierarchy, HierarchyNode, Vec3 } from "./types";

export type SharedUniforms = Record<string, THREE.IUniform>;

export interface NodeRuntime {
  info: HierarchyNode;
  lod: LodNode;
  state: "none" | "queued" | "loading" | "loaded" | "failed";
  points?: THREE.Points;
  pickMaterial?: THREE.ShaderMaterial;
  decoded?: DecodedNode;
  lastVisibleFrame: number;
  slot: number;
  priority: number;
}

export interface SlotRegistry {
  alloc(layer: PointCloudLayer, node: NodeRuntime): number;
  free(slot: number): void;
}

export type NodeFetcher = (datasetId: string, node: string) => Promise<ArrayBuffer>;

export const POINTS_LAYER = 1; // three.js render layer used by the pick pass

export class PointCloudLayer {
  readonly group = new THREE.Group();
  readonly nodes: NodeRuntime[];
  visible = true;
  loadedPoints = 0;
  visiblePoints = 0;
  visibleNodes = 0;
  private byName = new Map<string, number>();
  private extras: string[];

  constructor(
    readonly datasetId: string,
    readonly hierarchy: Hierarchy,
    readonly origin: Vec3,
    private uniforms: SharedUniforms,
    private slots: SlotRegistry,
  ) {
    this.extras = hierarchy.attributes.extras;
    this.nodes = hierarchy.nodes.map((info) => {
      const half = (info.max[0] - info.min[0]) / 2;
      return {
        info,
        lod: {
          cx: info.center[0] - origin[0],
          cy: info.center[1] - origin[1],
          cz: info.center[2] - origin[2],
          radius: half * Math.sqrt(3),
          count: info.count,
          children: [],
        },
        state: "none",
        lastVisibleFrame: -1,
        slot: 0,
        priority: 0,
      } satisfies NodeRuntime;
    });
    this.nodes.forEach((n, i) => this.byName.set(n.info.name, i));
    for (const n of this.nodes) {
      n.lod.children = n.info.children.map((c) => this.byName.get(`${n.info.name}${c}`)!).filter((i) => i !== undefined);
    }
    this.group.name = `layer:${datasetId}`;
  }

  get hasDz(): boolean {
    return this.extras.includes("dz");
  }

  /** Select nodes for this frame; returns nodes that should be requested (with priority). */
  update(view: LodView, frame: number): NodeRuntime[] {
    const lodNodes = this.nodes.map((n) => n.lod);
    const { visible } = this.visible ? selectNodes(lodNodes, view) : { visible: [] as number[] };
    const want = new Set(visible);
    const requests: NodeRuntime[] = [];
    let vp = 0;
    let vn = 0;
    this.nodes.forEach((n, i) => {
      const show = want.has(i);
      if (n.points) n.points.visible = show;
      if (show) {
        n.lastVisibleFrame = frame;
        if (n.state === "loaded") {
          vp += n.info.count;
          vn++;
        } else if (n.state === "none") {
          const dx = n.lod.cx - view.camera[0];
          const dy = n.lod.cy - view.camera[1];
          const dz = n.lod.cz - view.camera[2];
          n.priority = n.lod.radius / Math.max(Math.hypot(dx, dy, dz) - n.lod.radius, 1e-3);
          requests.push(n);
        }
      }
    });
    this.visiblePoints = vp;
    this.visibleNodes = vn;

    // Adaptive point size: a node's points are drawn at the spacing of its deepest visible
    // descendant, so coarse parents don't paint big blobs over refined areas (Potree-like).
    const deepest = new Map<number, number>();
    const depthOf = (i: number): number => {
      const cached = deepest.get(i);
      if (cached !== undefined) return cached;
      let d = this.nodes[i]!.info.level;
      for (const c of this.nodes[i]!.lod.children) if (want.has(c)) d = Math.max(d, depthOf(c));
      deepest.set(i, d);
      return d;
    };
    for (const i of visible) {
      const n = this.nodes[i]!;
      const u = n.points ? (n.points.material as THREE.ShaderMaterial).uniforms.uSpacing : undefined;
      if (u) u.value = n.info.spacing / 2 ** (depthOf(i) - n.info.level);
    }
    return requests;
  }

  async load(n: NodeRuntime, fetchNode: NodeFetcher): Promise<void> {
    n.state = "loading";
    try {
      const buf = await fetchNode(this.datasetId, n.info.name);
      if (n.state !== "loading") return; // disposed meanwhile
      const d = decodeNode(buf, n.info.count, this.extras);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(d.position, 3));
      g.setAttribute("color", new THREE.BufferAttribute(d.rgb, 3, true));
      g.setAttribute("intensity", new THREE.BufferAttribute(d.intensity, 1, true));
      g.setAttribute("classification", new THREE.BufferAttribute(d.classification, 1, false));
      g.setAttribute("dz", new THREE.BufferAttribute(d.extras.dz ?? new Float32Array(d.count), 1));
      const half = (n.info.max[0] - n.info.min[0]) / 2;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), half * Math.sqrt(3));

      n.slot = this.slots.alloc(this, n);
      const own = {
        uSpacing: { value: n.info.spacing },
        uNodeSlot: { value: n.slot },
        uHasDz: { value: this.hasDz ? 1 : 0 },
      };
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        uniforms: { ...this.uniforms, ...own },
      });
      n.pickMaterial = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        uniforms: { ...this.uniforms, ...own },
        defines: { PICK: 1 },
      });
      const pts = new THREE.Points(g, material);
      pts.position.set(n.lod.cx, n.lod.cy, n.lod.cz); // centre - origin (float64 difference, small)
      pts.frustumCulled = false; // LOD already culls
      pts.layers.enable(POINTS_LAYER);
      pts.matrixAutoUpdate = false;
      pts.updateMatrix();
      pts.userData = { layer: this, node: n };
      n.points = pts;
      n.decoded = d;
      n.state = "loaded";
      this.loadedPoints += n.info.count;
      this.group.add(pts);
    } catch (err) {
      n.state = "failed";
      console.warn(`node ${n.info.name} failed`, err);
    }
  }

  unload(n: NodeRuntime): void {
    if (n.points) {
      this.group.remove(n.points);
      n.points.geometry.dispose();
      (n.points.material as THREE.Material).dispose();
      n.pickMaterial?.dispose();
      this.loadedPoints -= n.info.count;
    }
    if (n.slot) this.slots.free(n.slot);
    n.points = undefined;
    n.pickMaterial = undefined;
    n.decoded = undefined;
    n.slot = 0;
    n.state = "none";
  }

  /** Unload least-recently-visible nodes until under maxPoints (never the current frame's nodes). */
  evict(maxPoints: number, frame: number): void {
    if (this.loadedPoints <= maxPoints) return;
    const candidates = this.nodes
      .filter((n) => n.state === "loaded" && n.lastVisibleFrame < frame && n.info.level > 0)
      .sort((a, b) => a.lastVisibleFrame - b.lastVisibleFrame);
    for (const n of candidates) {
      if (this.loadedPoints <= maxPoints) break;
      this.unload(n);
    }
  }

  dispose(): void {
    this.nodes.forEach((n) => this.unload(n));
  }
}
