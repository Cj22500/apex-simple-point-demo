/// <reference types="vite/client" />
declare module "laz-perf/lib/worker/index.js" {
  export function createLazPerf(opts?: { locateFile?: (path: string) => string }): Promise<unknown>;
}
