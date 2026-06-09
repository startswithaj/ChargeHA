import type { DemoSeries } from "./series.ts";
import { buildDemoSeries } from "./demoSimulate.ts";

// Runs the ~250ms simulation once per session. Currently on the main thread,
// behind the app's initial load; can be moved to a Web Worker if it ever janks.
// deno-lint-ignore custom-no-let/no-let
let seriesPromise: Promise<DemoSeries> | null = null;

/** Build (and cache) the demo series for this session. */
export const loadDemoSeries = (): Promise<DemoSeries> => {
  if (!seriesPromise) {
    seriesPromise = Promise.resolve().then(() => buildDemoSeries());
  }
  return seriesPromise;
};
