import type { PointCloudEngine } from "../engine/PointCloudEngine";

let current: PointCloudEngine | null = null;
export const setEngine = (e: PointCloudEngine | null) => {
  current = e;
};
export const getEngine = () => current;
