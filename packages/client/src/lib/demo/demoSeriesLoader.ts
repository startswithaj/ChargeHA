import type { DemoSeries } from "./series.ts";

// Loads the gzipped demo series and decompresses it in the browser. The artifact
// is committed gzipped (~330 KB) and decoded via the native DecompressionStream,
// so nothing large lands in the JS bundle.

const viteMeta = import.meta as ImportMeta & { env?: { BASE_URL?: string } };

const seriesUrl = (): string =>
  `${viteMeta.env?.BASE_URL ?? "/"}demo/series.json.gz`;

/** Decompress gzipped series bytes into the parsed series object. */
export const decodeSeries = async (
  gzipped: ArrayBuffer,
): Promise<DemoSeries> => {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(gzipped));
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).json() as DemoSeries;
};

const fetchSeries = async (): Promise<DemoSeries> => {
  const res = await fetch(seriesUrl());
  if (!res.ok) {
    throw new Error(`Failed to load demo series: HTTP ${res.status}`);
  }
  return decodeSeries(await res.arrayBuffer());
};

// Lazy singleton: fetch + decode once per session.
// deno-lint-ignore custom-no-let/no-let
let seriesPromise: Promise<DemoSeries> | null = null;

/** Load (and cache) the demo series for this session. */
export const loadDemoSeries = (): Promise<DemoSeries> => {
  if (!seriesPromise) seriesPromise = fetchSeries();
  return seriesPromise;
};
