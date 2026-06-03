import { describe, expect, it } from "vitest";
import { decodeSeries } from "./demoSeriesLoader.ts";
import type { DemoSeries } from "./series.ts";

describe("demoSeriesLoader", () => {
  /** gzip a string using the same native API the generator uses. */
  const gzip = async (text: string): Promise<ArrayBuffer> => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    const stream = source.pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
  };

  describe("decodeSeries", () => {
    it("round-trips a gzipped series", async () => {
      const series: DemoSeries = {
        bucketMinutes: 15,
        vehicles: [
          {
            id: "SIM-DEMO-001",
            name: "Model 3 SR+",
            capacityKwh: 60,
            chargeLimitPercent: 80,
            priority: 1,
          },
        ],
        days: [
          {
            offset: 0,
            readings: [
              {
                time: "08:15",
                solarW: 2100,
                homeW: 600,
                gridW: -1500,
                charge: [],
              },
            ],
            logs: [],
          },
        ],
      };

      const decoded = await decodeSeries(await gzip(JSON.stringify(series)));

      expect(decoded.bucketMinutes).toBe(15);
      expect(decoded.vehicles[0].name).toBe("Model 3 SR+");
      expect(decoded.days[0].readings[0].solarW).toBe(2100);
    });
  });
});
