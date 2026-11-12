/**
 * Viewer engine (framework-independent). React talks to it through a small command API.
 *
 * Render space is RTC: world = absolute [E, N, H] - origin (float64 origin chosen from the first
 * dataset). Three.js is Z-up here so that x = east, y = north, z = height without axis swaps.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CLASS_COLORS, diverging, turbo } from "./colormaps";
import { pointAt } from "./decode";
import type { LodView, Plane } from "./lod";
import { Overlay, type OverlayItem } from "./Overlay";
import { PointCloudLayer, POINTS_LAYER, type NodeFetcher, type NodeRuntime, type SharedUniforms, type SlotRegistry } from "./PointCloudLayer";
import { edlFragment, edlVertex } from "./shaders";
import { SplatLayer } from "./SplatLayer";
import type { Hierarchy, Vec3 } from "./types";

export type ColorMode = "rgb" | "elevation" | "intensity" | "classification" | "change";
const COLOR_MODE_INDEX: Record<ColorMode, number> = { rgb: 0, elevation: 1, intensity: 2, classification: 3, change: 4 };

export interface EngineSettings {
  colorMode: ColorMode;
  pointBudget: number;
  pointSize: number;
  sizeMode: "fixed" | "adaptive";
  edl: boolean;
  zRange: [number, number] | null;
  dzRange: number;
}

export interface EngineStats {
  fps: number;
  visiblePoints: number;
  visibleNodes: number;
  loadedPoints: number;
  pending: number;
  gpuMB: number;
}

export interface PickHit {
  position: Vec3; // absolute float64 [E, N, H]
  datasetId: string;
  node: string;
  index: number;
  sourceIndex: number;
  dz?: number;
}

export interface SectionClip {
  a: Vec3;
  b: Vec3;
  halfWidth: number;
  mode: "slab" | "highlight";
}

const BYTES_PER_POINT = 12 + 3 + 2 + 1 + 4;
const MAX_CONCURRENT = 6;

export class PointCloudEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly overlay = new Overlay();
  readonly splats: SplatLayer;
  private fetchers = new Map<string, NodeFetcher>();
  private labels: CSS2DRenderer;
  private layers = new Map<string, PointCloudLayer>();
  private origin: Vec3 | null = null;
  private frame = 0;
  private raf = 0;
  private inflight = 0;
  private queue: { layer: PointCloudLayer; node: NodeRuntime }[] = [];
  private slotMap = new Map<number, { layer: PointCloudLayer; node: NodeRuntime }>();
  private freeSlots: number[] = [];
  private nextSlot = 1;
  private lastTime = performance.now();
  private fps = 60;
  private statsListeners = new Set<(s: EngineStats) => void>();
  private pickTarget = new THREE.WebGLRenderTarget(15, 15, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
  private edlTarget: THREE.WebGLRenderTarget;
  private edlScene: THREE.Scene;
  private edlCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private edlMaterial: THREE.ShaderMaterial;
  private resizeObserver: ResizeObserver;
  private photoMode = false;
  settings: EngineSettings = {
    colorMode: "rgb",
    pointBudget: 2_000_000,
    pointSize: 1.8,
    sizeMode: "adaptive",
    edl: true,
    zRange: null,
    dzRange: 0.05,
  };

  readonly uniforms: SharedUniforms;

  constructor(private container: HTMLElement, private fetchNode: NodeFetcher) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b0f14);
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "label-layer";
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.layers.enable(POINTS_LAYER);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;

    const tex = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    const classColors = Array.from({ length: 16 }, (_, i) => {
      const c = CLASS_COLORS[i] ?? [160, 160, 160];
      return new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255);
    });
    this.uniforms = {
      uPointSize: { value: this.settings.pointSize },
      uSizeMode: { value: 1 },
      uProjFactor: { value: 500 },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uColorMode: { value: 0 },
      uOriginZ: { value: 0 },
      uZRange: { value: new THREE.Vector2(0, 10) },
      uIntensityRange: { value: new THREE.Vector2(0, 65535) },
      uIntensityGamma: { value: 0.8 },
      uDzRange: { value: 0.05 },
      uElevationMap: { value: tex(turbo()) },
      uDivergingMap: { value: tex(diverging()) },
      uClassColors: { value: classColors },
      uClipMode: { value: 0 },
      uClipCenter: { value: new THREE.Vector3() },
      uClipAxis: { value: new THREE.Vector2(1, 0) },
      uClipHalfLength: { value: 1 },
      uClipHalfWidth: { value: 1 },
    };

    this.scene.add(this.overlay.group);
    this.splats = new SplatLayer(this.scene, this.renderer);

    this.edlTarget = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    this.edlMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: edlVertex,
      fragmentShader: edlFragment,
      uniforms: {
        tColor: { value: this.edlTarget.texture },
        tDepth: { value: this.edlTarget.depthTexture },
        uTexel: { value: new THREE.Vector2() },
        uStrength: { value: 0.6 },
        uNear: { value: 0.05 },
        uFar: { value: 20000 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.edlScene = new THREE.Scene();
    this.edlScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.edlMaterial));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ layers
  getOrigin(): Vec3 | null {
    return this.origin;
  }

  /** fetcher: optional per-layer node source (e.g. an in-memory offline octree). */
  addLayer(datasetId: string, hierarchy: Hierarchy, fetcher?: NodeFetcher): PointCloudLayer {
    if (fetcher) this.fetchers.set(datasetId, fetcher);
    if (!this.origin) {
      const m = hierarchy.bounds.min;
      this.origin = [Math.floor(m[0]), Math.floor(m[1]), 0];
      this.uniforms.uOriginZ!.value = this.origin[2];
      this.overlay.setOrigin(this.origin);
      if (!this.settings.zRange) {
        const s = hierarchy.stats;
        this.setSettings({ zRange: [Math.floor(s.z_p01 ?? s.z_min ?? 0), Math.ceil(s.z_p99 ?? s.z_max ?? 10)] });
      }
      this.uniforms.uIntensityRange!.value.set(hierarchy.stats.intensity_p02 ?? 0, hierarchy.stats.intensity_p98 ?? 65535);
    }
    const slots: SlotRegistry = {
      alloc: (layer, node) => {
        const s = this.freeSlots.pop() ?? this.nextSlot++;
        if (s >= 4096) throw new Error("too many resident nodes");
        this.slotMap.set(s, { layer, node });
        return s;
      },
      free: (s) => {
        this.slotMap.delete(s);
        this.freeSlots.push(s);
      },
    };
    const layer = new PointCloudLayer(datasetId, hierarchy, this.origin, this.uniforms, slots);
    this.layers.set(datasetId, layer);
    this.scene.add(layer.group);
    if (this.layers.size === 1) this.fitView();
    return layer;
  }

  removeLayer(datasetId: string) {
    const l = this.layers.get(datasetId);
    if (!l) return;
    l.dispose();
    this.scene.remove(l.group);
    this.layers.delete(datasetId);
    this.fetchers.delete(datasetId);
  }

  setLayerVisible(datasetId: string, visible: boolean) {
    const l = this.layers.get(datasetId);
    if (l) l.visible = visible;
  }

  hasLayer(datasetId: string) {
    return this.layers.has(datasetId);
  }

  // ------------------------------------------------------------------ settings
  setSettings(patch: Partial<EngineSettings>) {
    this.settings = { ...this.settings, ...patch };
    const s = this.settings;
    this.uniforms.uColorMode!.value = COLOR_MODE_INDEX[s.colorMode];
    this.uniforms.uPointSize!.value = s.pointSize;
    this.uniforms.uSizeMode!.value = s.sizeMode === "adaptive" ? 1 : 0;
    this.uniforms.uDzRange!.value = s.dzRange;
    if (s.zRange) this.uniforms.uZRange!.value.set(s.zRange[0], s.zRange[1]);
  }

  setClip(clip: SectionClip | null) {
    const u = this.uniforms;
    if (!clip || !this.origin) {
      u.uClipMode!.value = 0;
      return;
    }
    const o = this.origin;
    const ax = clip.b[0] - clip.a[0];
    const ay = clip.b[1] - clip.a[1];
    const len = Math.hypot(ax, ay) || 1;
    u.uClipMode!.value = clip.mode === "slab" ? 1 : 2;
    u.uClipCenter!.value.set((clip.a[0] + clip.b[0]) / 2 - o[0], (clip.a[1] + clip.b[1]) / 2 - o[1], 0);
    u.uClipAxis!.value.set(ax / len, ay / len);
    u.uClipHalfLength!.value = len / 2;
    u.uClipHalfWidth!.value = clip.halfWidth;
  }

  setOverlay(items: OverlayItem[], pending: Vec3[] = []) {
    this.overlay.set(items, pending);
  }

  onStats(cb: (s: EngineStats) => void): () => void {
    this.statsListeners.add(cb);
    return () => this.statsListeners.delete(cb);
  }

  // ------------------------------------------------------------------ camera
  fitView() {
    const first = [...this.layers.values()][0];
    if (!first || !this.origin) return;
    const { min, max } = first.hierarchy.bounds;
    const c = new THREE.Vector3((min[0] + max[0]) / 2 - this.origin[0], (min[1] + max[1]) / 2 - this.origin[1], (min[2] + max[2]) / 2 - this.origin[2]);
    const size = Math.max(max[0] - min[0], max[1] - min[1]);
    this.controls.target.copy(c);
    this.camera.position.set(c.x - size * 0.35, c.y - size * 0.75, c.z + size * 0.55);
    this.controls.update();
  }

  lookAt(target: Vec3, distance = 25) {
    if (!this.origin) return;
    const t = new THREE.Vector3(target[0] - this.origin[0], target[1] - this.origin[1], target[2] - this.origin[2]);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(t);
    this.camera.position.copy(t.clone().add(dir.multiplyScalar(distance)));
    this.controls.update();
  }

  /** Put the camera at an absolute pose (photos): position + forward direction (unit, ENU). */
  setPose(position: Vec3, forward: Vec3, fovDeg?: number) {
    if (!this.origin) return;
    const p = new THREE.Vector3(position[0] - this.origin[0], position[1] - this.origin[1], position[2] - this.origin[2]);
    this.camera.position.copy(p);
    this.controls.target.copy(p.clone().add(new THREE.Vector3(...forward).multiplyScalar(10)));
    if (fovDeg) {
      this.camera.fov = fovDeg;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
  }

  resetFov() {
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Put the camera exactly at a photo's pose. rows = world->camera rotation rows [right, down,
   * forward] (OpenCV convention, see backend core/photos.py). Orbit controls are suspended because
   * they cannot represent a nadir view with a Z-up camera (gimbal singularity).
   */
  enterPhotoView(center: Vec3, rows: readonly (readonly [number, number, number])[], vfovDeg: number) {
    if (!this.origin) return;
    const [right, down, fwd] = rows.map((r) => new THREE.Vector3(r[0], r[1], r[2]));
    const basis = new THREE.Matrix4().makeBasis(right!, down!.clone().negate(), fwd!.clone().negate());
    this.photoMode = true;
    this.controls.enabled = false;
    this.camera.position.set(center[0] - this.origin[0], center[1] - this.origin[1], center[2] - this.origin[2]);
    this.camera.quaternion.setFromRotationMatrix(basis);
    this.camera.fov = vfovDeg;
    this.camera.updateProjectionMatrix();
  }

  exitPhotoView() {
    if (!this.photoMode) return;
    this.photoMode = false;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.controls.target.copy(this.camera.position.clone().add(fwd.multiplyScalar(30)));
    this.camera.up.set(0, 0, 1);
    this.controls.enabled = true;
    this.resetFov();
    this.controls.update();
  }

  /** Absolute [E, N, H] -> CSS pixel position in the viewer (null if behind the camera). */
  project(p: Vec3): { x: number; y: number } | null {
    if (!this.origin) return null;
    const v = new THREE.Vector3(p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]).project(this.camera);
    if (v.z > 1) return null;
    // canvas size, not container size: they differ until the next resize
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  // ------------------------------------------------------------------ picking
  /** GPU ID picking around a CSS-pixel position; returns the exact float64 point. */
  pick(clientX: number, clientY: number, radius = 7): PickHit | null {
    if (!this.origin) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const size = 2 * radius + 1;
    this.pickTarget.setSize(size, size);

    const swapped: { pts: THREE.Points; mat: THREE.Material }[] = [];
    for (const layer of this.layers.values()) {
      for (const n of layer.nodes) {
        if (n.points?.visible && n.pickMaterial) {
          swapped.push({ pts: n.points, mat: n.points.material as THREE.Material });
          n.points.material = n.pickMaterial;
        }
      }
    }
    const prevPR = this.uniforms.uPixelRatio!.value;
    this.uniforms.uPixelRatio!.value = 1;
    this.camera.setViewOffset(rect.width, rect.height, x - radius, y - radius, size, size);
    const prevLayers = this.camera.layers.mask;
    this.camera.layers.set(POINTS_LAYER);
    const prevClear = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const buf = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, size, size, buf);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x0b0f14, prevClear || 1);
    this.camera.layers.mask = prevLayers;
    this.camera.clearViewOffset();
    this.uniforms.uPixelRatio!.value = prevPR;
    for (const s of swapped) s.pts.material = s.mat;

    let best: { id: number; d: number } | null = null;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const o = (py * size + px) * 4;
        const id = ((buf[o]! << 24) | (buf[o + 1]! << 16) | (buf[o + 2]! << 8) | buf[o + 3]!) >>> 0;
        if (id === 0) continue;
        const d = (px - radius) ** 2 + (py - radius) ** 2;
        if (!best || d < best.d) best = { id, d };
      }
    }
    if (!best) return null;
    const slot = best.id >>> 20;
    const index = best.id & 0xfffff;
    const entry = this.slotMap.get(slot);
    if (!entry?.node.decoded || index >= entry.node.decoded.count) return null;
    const { layer, node } = entry;
    return {
      position: pointAt(node.info.center, node.decoded!, index),
      datasetId: layer.datasetId,
      node: node.info.name,
      index,
      sourceIndex: node.decoded!.index[index]!,
      dz: node.decoded!.extras.dz?.[index],
    };
  }

  // ------------------------------------------------------------------ frame loop
  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.edlTarget.setSize(w * pr, h * pr);
    (this.edlMaterial.uniforms.uTexel!.value as THREE.Vector2).set(1 / (w * pr), 1 / (h * pr));
  }

  private frustumPlanes(): Plane[] {
    const f = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    return f.planes.map((p) => [p.normal.x, p.normal.y, p.normal.z, p.constant] as Plane);
  }

  private pump() {
    this.queue.sort((a, b) => b.node.priority - a.node.priority);
    while (this.inflight < MAX_CONCURRENT && this.queue.length) {
      const { layer, node } = this.queue.shift()!;
      if (node.state !== "queued") continue;
      this.inflight++;
      layer.load(node, this.fetchers.get(layer.datasetId) ?? this.fetchNode).finally(() => {
        this.inflight--;
        this.pump();
      });
    }
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = now - this.lastTime;
    this.lastTime = now;
    if (dt > 0) this.fps = this.fps * 0.92 + (1000 / dt) * 0.08;
    this.frame++;
    const canvas = this.renderer.domElement;
    if (canvas.clientWidth !== this.container.clientWidth || canvas.clientHeight !== this.container.clientHeight) {
      this.resize(); // ResizeObserver can miss changes while the page is hidden
    }
    if (!this.photoMode) this.controls.update();
    this.camera.updateMatrixWorld();

    const h = canvas.clientHeight || 1;
    const projFactor = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.uniforms.uProjFactor!.value = projFactor;
    const visibleLayers = [...this.layers.values()].filter((l) => l.visible);
    const view: LodView = {
      camera: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      frustum: this.frustumPlanes(),
      projFactor,
      pointBudget: this.settings.pointBudget / Math.max(1, visibleLayers.length),
      minPixelRadius: 25,
    };
    for (const layer of this.layers.values()) {
      for (const n of layer.update(view, this.frame)) {
        n.state = "queued";
        this.queue.push({ layer, node: n });
      }
      layer.evict(Math.max(this.settings.pointBudget * 1.6, 3_000_000) / Math.max(1, this.layers.size), this.frame);
    }
    this.queue = this.queue.filter((q) => q.node.state === "queued");
    this.pump();

    if (this.settings.edl) {
      this.renderer.setRenderTarget(this.edlTarget);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.edlMaterial.uniforms.uNear!.value = this.camera.near;
      this.edlMaterial.uniforms.uFar!.value = this.camera.far;
      this.renderer.render(this.edlScene, this.edlCamera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.labels.render(this.scene, this.camera);

    if (this.frame % 10 === 0) {
      let vp = 0, vn = 0, lp = 0;
      for (const l of this.layers.values()) {
        vp += l.visiblePoints;
        vn += l.visibleNodes;
        lp += l.loadedPoints;
      }
      const stats: EngineStats = {
        fps: this.fps,
        visiblePoints: vp,
        visibleNodes: vn,
        loadedPoints: lp,
        pending: this.queue.length + this.inflight,
        gpuMB: (lp * BYTES_PER_POINT) / 1048576,
      };
      this.statsListeners.forEach((cb) => cb(stats));
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const id of [...this.layers.keys()]) this.removeLayer(id);
    this.overlay.clear();
    this.splats.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
