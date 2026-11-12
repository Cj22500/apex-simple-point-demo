/**
 * 3D Gaussian Splatting layer (Spark, Three.js-native). The splat PLY is written by the backend in
 * the same RTC frame as the point layers (positions relative to the engine origin), so splats,
 * points, measurements and sections share one scene without any transform.
 */
import type * as THREE from "three";

type Spark = typeof import("@sparkjsdev/spark");

export class SplatLayer {
  private mesh: InstanceType<Spark["SplatMesh"]> | null = null;
  private spark: InstanceType<Spark["SparkRenderer"]> | null = null;
  count = 0;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {}

  async load(bytes: ArrayBuffer, splatCount: number): Promise<void> {
    const mod: Spark = await import("@sparkjsdev/spark"); // lazy: only downloaded when the layer is used
    this.dispose();
    if (!this.spark) {
      this.spark = new mod.SparkRenderer({ renderer: this.renderer });
      this.scene.add(this.spark);
    }
    this.mesh = new mod.SplatMesh({ fileBytes: new Uint8Array(bytes), fileType: "ply" as never });
    await this.mesh.initialized;
    this.scene.add(this.mesh);
    this.count = splatCount;
  }

  setVisible(v: boolean) {
    if (this.mesh) this.mesh.visible = v;
  }

  get loaded() {
    return this.mesh !== null;
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
      this.count = 0;
    }
  }
}
