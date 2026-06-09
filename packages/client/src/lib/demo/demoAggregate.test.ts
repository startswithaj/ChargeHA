import { describe, expect, it } from "vitest";
import {
  aggregateDay,
  aggregateMonth,
  aggregateYear,
} from "./demoAggregate.ts";
import { dateForOffset } from "./demoDates.ts";
import type { DemoReading, DemoSeries } from "./series.ts";

describe("demoAggregate", () => {
  // Mid-month so offsets 0 and 1 share the same month.
  const now = new Date(2026, 5, 15, 12, 0);

  const reading = (
    time: string,
    solarW: number,
    homeW: number,
    charge: DemoReading["charge"] = [],
  ): DemoReading => ({ time, solarW, homeW, gridW: homeW - solarW, charge });

  const makeSeries = (days: DemoSeries["days"]): DemoSeries => ({
    bucketMinutes: 15,
    vehicles: [{
      id: "V1",
      name: "Car One",
      capacityKwh: 60,
      chargeLimitPercent: 80,
      priority: 1,
    }],
    days,
  });

  const dayZero = {
    offset: 0,
    logs: [],
    readings: [
      reading("08:00", 4000, 1000), // solar surplus, exporting
      reading("14:00", 0, 2000, [ // peak hour, importing + charging
        { vehicleId: "V1", w: 3600, amps: 16, soc: 50, solarC: 0, gridC: 3600 },
      ]),
    ],
  };

  describe("aggregateDay (1h)", () => {
    const date = dateForOffset(0, now);
    const stats = aggregateDay(
      makeSeries([dayZero]),
      date,
      "1h",
      undefined,
      now,
    );

    it("returns 24 hourly buckets for the day", () => {
      expect(stats.period).toBe("day");
      expect(stats.startDate).toBe(date);
      expect(stats.energyBuckets).toHaveLength(24);
      expect(stats.buckets).toHaveLength(24);
    });

    it("derives home energy per bucket (15-min reading = Wh/4)", () => {
      const h8 = stats.energyBuckets[8];
      expect(h8.solarProductionWh).toBe(1000); // 4000 * 0.25
      expect(h8.solarWh).toBe(250); // min(4000,1000) * 0.25
      expect(h8.gridWh).toBe(0); // exporting
      const h14 = stats.energyBuckets[14];
      expect(h14.gridWh).toBe(500); // 2000 * 0.25
      expect(h14.costCents).toBe(23); // 500Wh * 0.45 /10 = 22.5 -> 23
    });

    it("aggregates charging into the matching bucket", () => {
      expect(stats.buckets[14].gridWh).toBe(900); // 3600 * 0.25
      expect(stats.totalGridWh).toBe(900);
    });

    it("builds a per-rate tariff breakdown for charging", () => {
      expect(stats.tariffBreakdown).toEqual([
        { label: "Peak", ratePerKwh: 0.45, gridWh: 900, costCents: 41 },
      ]);
    });

    it("carries vehicle SoC forward across buckets", () => {
      expect(stats.vehicleSoc?.[14]).toEqual([
        { vehicleId: "V1", vehicleName: "Car One", batteryLevel: 50 },
      ]);
      expect(stats.vehicleSoc?.[20]).toEqual([
        { vehicleId: "V1", vehicleName: "Car One", batteryLevel: 50 },
      ]);
    });
  });

  describe("aggregateDay (15m)", () => {
    it("returns 96 buckets", () => {
      const date = dateForOffset(0, now);
      const stats = aggregateDay(
        makeSeries([dayZero]),
        date,
        "15m",
        undefined,
        now,
      );
      expect(stats.energyBuckets).toHaveLength(96);
      expect(stats.energyBuckets[32].solarProductionWh).toBe(1000); // 08:00 = bucket 32
    });
  });

  describe("aggregateMonth", () => {
    it("buckets by day-of-month across the series", () => {
      const series = makeSeries([dayZero, { ...dayZero, offset: 1 }]);
      const stats = aggregateMonth(series, 2026, 6, undefined, now);
      expect(stats.period).toBe("month");
      expect(stats.buckets).toHaveLength(30); // June
      expect(stats.buckets[14].gridWh).toBe(900); // 15th (offset 0)
      expect(stats.buckets[13].gridWh).toBe(900); // 14th (offset 1)
    });
  });

  describe("aggregateYear", () => {
    it("buckets by month with 12 entries", () => {
      const stats = aggregateYear(makeSeries([dayZero]), 2026, undefined, now);
      expect(stats.period).toBe("year");
      expect(stats.buckets).toHaveLength(12);
      expect(stats.buckets[5].gridWh).toBe(900); // June = index 5
      expect(stats.energyBuckets[5].label).toBe("Jun");
    });
  });
});
