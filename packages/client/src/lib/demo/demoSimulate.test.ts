import { describe, expect, it } from "vitest";
import { buildDemoSeries } from "./demoSimulate.ts";
import { timeToMinutes } from "./demoDates.ts";

describe("demoSimulate", () => {
  const now = new Date(2026, 5, 3, 10, 0); // 10:00 local

  describe("buildDemoSeries", () => {
    it("builds 90 days with the demo vehicle at 15-minute buckets", () => {
      const series = buildDemoSeries(now);
      expect(series.days).toHaveLength(90);
      expect(series.bucketMinutes).toBe(15);
      expect(series.vehicles.map((v) => v.name)).toEqual(["Demo EV"]);
    });

    it("truncates today (offset 0) to the current time-of-day", () => {
      const series = buildDemoSeries(now);
      const today = series.days[0];
      expect(today.offset).toBe(0);
      expect(today.readings.length).toBeLessThanOrEqual(41); // 00:00..10:00
      expect(
        today.readings.every((r) => timeToMinutes(r.time) <= 600),
      ).toBe(true);
    });

    it("keeps past days as full 96-bucket days", () => {
      const series = buildDemoSeries(now);
      const yesterday = series.days[1];
      expect(yesterday.offset).toBe(1);
      expect(yesterday.readings).toHaveLength(96);
    });

    it("produces charging sessions on at least one day", () => {
      const series = buildDemoSeries(now);
      const hasCharge = series.days.some((d) =>
        d.readings.some((r) => r.charge.length > 0)
      );
      expect(hasCharge).toBe(true);
    });

    it("is deterministic for a fixed now", () => {
      expect(buildDemoSeries(now).days[1]).toEqual(
        buildDemoSeries(now).days[1],
      );
    });
  });
});
