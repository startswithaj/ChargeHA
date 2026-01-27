import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { StatsService } from "./StatsService.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("StatsService", () => {
  /** Create a mock AppDatabase with controllable return values. */
  const mockDb = (
    overrides: {
      // deno-lint-ignore no-explicit-any
      stats?: Record<string, (...args: any[]) => any>;
      // deno-lint-ignore no-explicit-any
      vehicles?: Record<string, (...args: any[]) => any>;
      // deno-lint-ignore no-explicit-any
      [key: string]: unknown | ((...args: any[]) => any);
    } = {},
  ): AppDatabase => {
    const { stats, vehicles, ...rest } = overrides;
    const partial = {
      stats: {
        getEnergyStatsDayDetailed: () => Promise.resolve([]),
        getStatsDayDetailed: () => Promise.resolve([]),
        getEnergyStatsDay: () => Promise.resolve([]),
        getStatsDay: () => Promise.resolve([]),
        getEnergyStatsMonth: () => Promise.resolve([]),
        getStatsMonth: () => Promise.resolve([]),
        getSolarProductionMonth: () => Promise.resolve([]),
        getEnergyStatsYear: () => Promise.resolve([]),
        getStatsYear: () => Promise.resolve([]),
        getSolarProductionYear: () => Promise.resolve([]),
        getTariffBreakdown: () => Promise.resolve([]),
        ...stats,
      },
      vehicles: {
        getVehicleSocForDay: () => Promise.resolve([]),
        ...vehicles,
      },
      getConfig: () => Promise.resolve(null),
      getTariffPeriods: () => Promise.resolve([]),
      ...rest,
    } as unknown as Partial<AppDatabase>;
    return throwingMock<AppDatabase>("AppDatabase", partial);
  };

  /** Helper to create a getConfig mock from a key-value map. */
  const configMap = (
    entries: Record<string, string>,
  ): (key: string) => Promise<string | null> =>
  (key: string) => Promise.resolve(entries[key] ?? null);

  describe("buildDayStats — detailed (15m)", () => {
    it("fills 96 charge buckets from detailed charge rows", async () => {
      const db = mockDb({
        stats: {
          getStatsDayDetailed: () =>
            Promise.resolve([{
              bucket: 42,
              solarWh: 100,
              gridWh: 200,
              awayWh: 50,
              totalWh: 350,
              costCents: 60,
              solarSavingsCents: 20,
            }]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        true,
      );

      expect(result.buckets).toHaveLength(96);
      expect(result.buckets[42].solarWh).toBe(100);
      expect(result.buckets[42].gridWh).toBe(200);
      expect(result.buckets[42].awayWh).toBe(50);
      expect(result.buckets[42].totalWh).toBe(350);
      expect(result.buckets[42].costCents).toBe(60);
      expect(result.solarSavingsCents).toBe(20);
    });

    it("accumulates solarSavingsCents across detailed charge rows", async () => {
      const db = mockDb({
        stats: {
          getStatsDayDetailed: () =>
            Promise.resolve([
              {
                bucket: 10,
                solarWh: 50,
                gridWh: 50,
                awayWh: 0,
                totalWh: 100,
                costCents: 10,
                solarSavingsCents: 5,
              },
              {
                bucket: 20,
                solarWh: 80,
                gridWh: 20,
                awayWh: 0,
                totalWh: 100,
                costCents: 4,
                solarSavingsCents: 15,
              },
            ]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        true,
      );

      expect(result.solarSavingsCents).toBe(20);
    });
  });

  describe("buildMonthStats", () => {
    it("fills energy buckets from row data", async () => {
      const db = mockDb({
        stats: {
          getEnergyStatsMonth: () =>
            Promise.resolve([{
              bucket: "15",
              solarProductionWh: 5000,
              solarWh: 3000,
              gridWh: 2000,
              totalWh: 5000,
              costCents: 100,
            }]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildMonthStats(2026, 3, 0, undefined);

      // day 15 → index 14
      expect(result.energyBuckets[14].solarProductionWh).toBe(5000);
      expect(result.energyBuckets[14].solarWh).toBe(3000);
      expect(result.energyBuckets[14].gridWh).toBe(2000);
      expect(result.energyBuckets[14].totalWh).toBe(5000);
      expect(result.energyBuckets[14].costCents).toBe(100);
    });

    it("builds solar production line from row data", async () => {
      const db = mockDb({
        stats: {
          getSolarProductionMonth: () =>
            Promise.resolve([
              { day: 5, quarter: 2, solarProductionWh: 1000 },
            ]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildMonthStats(2026, 3, 0, undefined);

      // day 5, quarter 2 → x = 5 + 2*0.25 = 5.5
      // solarProductionKwh = round(1000 * 4 / 1000 * 100) / 100 = 4.0
      const point = result.solarProductionLine.find((p) => p.x === 5.5);
      assertExists(point);
      expect(point.solarProductionKwh).toBe(4);
    });
  });

  describe("buildYearStats", () => {
    it("fills energy buckets from row data", async () => {
      const db = mockDb({
        stats: {
          getEnergyStatsYear: () =>
            Promise.resolve([{
              bucket: "3",
              solarProductionWh: 8000,
              solarWh: 5000,
              gridWh: 3000,
              totalWh: 8000,
              costCents: 200,
            }]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildYearStats(2026, 0, undefined);

      // month 3 → index 2
      expect(result.energyBuckets[2].solarProductionWh).toBe(8000);
      expect(result.energyBuckets[2].solarWh).toBe(5000);
      expect(result.energyBuckets[2].gridWh).toBe(3000);
      expect(result.energyBuckets[2].totalWh).toBe(8000);
      expect(result.energyBuckets[2].costCents).toBe(200);
    });

    it("builds solar production line from row data", async () => {
      const db = mockDb({
        stats: {
          getSolarProductionYear: () =>
            Promise.resolve([
              { week: 10, solarProductionWh: 2000 },
            ]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildYearStats(2026, 0, undefined);

      // week 10 → index 10 in solarProductionLine (weeks 0-52)
      const point = result.solarProductionLine[10];
      expect(point.solarProductionKwh).toBeGreaterThan(0);
      // solarProductionKwh = round(2000 * (52/12) / 1000 * 100) / 100 ≈ 8.67
      expect(point.solarProductionKwh).toBeCloseTo(8.67, 1);
    });
  });

  describe("buildVehicleSocBuckets", () => {
    it("falls back to 00:00:00 when timestamp has no time part", async () => {
      const db = mockDb({
        vehicles: {
          getVehicleSocForDay: () =>
            Promise.resolve([{
              vehicleId: "V1",
              vehicleName: "Car",
              batteryLevel: 50,
              timestamp: "2026-03-01",
            }]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      // Without time part, falls back to "00:00:00" → bucket 0
      assertExists(result.vehicleSoc);
      expect(result.vehicleSoc[0][0].batteryLevel).toBe(50);
    });

    it("groups multiple logs into the same bucket", async () => {
      const db = mockDb({
        vehicles: {
          getVehicleSocForDay: () =>
            Promise.resolve([
              {
                vehicleId: "V1",
                vehicleName: "Car A",
                batteryLevel: 50,
                timestamp: "2026-03-01 10:05:00",
              },
              {
                vehicleId: "V2",
                vehicleName: "Car B",
                batteryLevel: 70,
                timestamp: "2026-03-01 10:30:00",
              },
            ]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      // Both logs in bucket 10 (hour 10) — covers the "existing" push branch
      assertExists(result.vehicleSoc);
      expect(result.vehicleSoc[10]).toHaveLength(2);
      expect(result.vehicleSoc[10][0].vehicleId).toBe("V1");
      expect(result.vehicleSoc[10][1].vehicleId).toBe("V2");
    });
  });

  describe("getCurrencyConfig", () => {
    it("returns configured currency when set in DB", async () => {
      const db = mockDb({
        getConfig: configMap({
          currency_symbol: "€",
          currency_code: "EUR",
        }),
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      expect(result.currencySymbol).toBe("€");
      expect(result.currencyCode).toBe("EUR");
    });

    it("defaults to $ and AUD when config is not set", async () => {
      const service = new StatsService(mockDb());
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      expect(result.currencySymbol).toBe("$");
      expect(result.currencyCode).toBe("AUD");
    });
  });

  describe("buildTariffBreakdown", () => {
    it("uses Default label when rate matches configured default rate", async () => {
      const db = mockDb({
        stats: {
          getTariffBreakdown: () =>
            Promise.resolve([
              { ratePerKwh: 25, gridWh: 1000, costCents: 250 },
            ]),
        },
        getTariffPeriods: () => Promise.resolve([]),
        getConfig: configMap({ default_rate_per_kwh: "25" }),
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      assertExists(result.tariffBreakdown);
      expect(result.tariffBreakdown[0].label).toBe("Default");
    });

    it("uses formatted rate label with currency when no period or default match", async () => {
      const db = mockDb({
        stats: {
          getTariffBreakdown: () =>
            Promise.resolve([
              { ratePerKwh: 99, gridWh: 500, costCents: 495 },
            ]),
        },
        getTariffPeriods: () => Promise.resolve([]),
        getConfig: configMap({ default_rate_per_kwh: "25" }),
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      // No matching period, 99 !== 25 (default), currency is $ (default)
      assertExists(result.tariffBreakdown);
      expect(result.tariffBreakdown[0].label).toBe("$99/kWh");
    });

    it("uses custom currency symbol in fallback rate label", async () => {
      const db = mockDb({
        stats: {
          getTariffBreakdown: () =>
            Promise.resolve([
              { ratePerKwh: 99, gridWh: 500, costCents: 495 },
            ]),
        },
        getTariffPeriods: () => Promise.resolve([]),
        getConfig: configMap({
          currency_symbol: "€",
          default_rate_per_kwh: "25",
        }),
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      assertExists(result.tariffBreakdown);
      expect(result.tariffBreakdown[0].label).toBe("€99/kWh");
    });

    it("skips disabled tariff periods when mapping rate labels", async () => {
      const db = mockDb({
        stats: {
          getTariffBreakdown: () =>
            Promise.resolve([
              { ratePerKwh: 10, gridWh: 1000, costCents: 100 },
            ]),
        },
        getTariffPeriods: () =>
          Promise.resolve([{
            id: 1,
            label: "Off-Peak",
            startTime: "00:00",
            endTime: "06:00",
            days: [],
            ratePerKwh: 10,
            enabled: false,
            createdAt: "",
            updatedAt: "",
          }]),
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      // Disabled period is skipped — rate 10 doesn't match default (0), so falls to formatted label
      assertExists(result.tariffBreakdown);
      expect(result.tariffBreakdown[0].label).toBe("$10/kWh");
    });

    it("returns empty breakdown when no rated readings exist", async () => {
      const service = new StatsService(mockDb());
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      expect(result.tariffBreakdown).toBeUndefined();
    });
  });

  describe("buildResponse", () => {
    it("computes selfPoweredPercent from charge solar and grid totals", async () => {
      const db = mockDb({
        stats: {
          getStatsDay: () =>
            Promise.resolve([{
              bucket: "10",
              solarWh: 3000,
              gridWh: 1000,
              awayWh: 0,
              totalWh: 4000,
              costCents: 100,
              solarSavingsCents: 60,
            }]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      // selfPoweredPercent = round(3000 / (3000+1000) * 100) = 75
      expect(result.selfPoweredPercent).toBe(75);
      expect(result.totalCostCents).toBe(100);
      expect(result.totalChargedWh).toBe(4000);
      expect(result.totalSolarWh).toBe(3000);
      expect(result.totalGridWh).toBe(1000);
    });

    it("computes homeSelfPoweredPercent from energy totals", async () => {
      const db = mockDb({
        stats: {
          getEnergyStatsDay: () =>
            Promise.resolve([{
              bucket: "10",
              solarProductionWh: 5000,
              solarWh: 4000,
              gridWh: 1000,
              totalWh: 5000,
              costCents: 50,
            }]),
        },
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      // homeSelfPoweredPercent = round(4000/5000 * 100) = 80
      expect(result.homeSelfPoweredPercent).toBe(80);
      expect(result.homeSolarProductionWh).toBe(5000);
      expect(result.homeConsumedWh).toBe(5000);
      expect(result.homeSolarWh).toBe(4000);
      expect(result.homeGridWh).toBe(1000);
    });

    it("returns 0 selfPoweredPercent when no home charge data", async () => {
      const service = new StatsService(mockDb());
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      expect(result.selfPoweredPercent).toBe(0);
      expect(result.homeSelfPoweredPercent).toBe(0);
    });

    it("includes tariffBreakdown when entries exist", async () => {
      const db = mockDb({
        stats: {
          getTariffBreakdown: () =>
            Promise.resolve([
              { ratePerKwh: 10, gridWh: 1000, costCents: 100 },
            ]),
        },
        getTariffPeriods: () =>
          Promise.resolve([{
            id: 1,
            label: "Off-Peak",
            startTime: "00:00",
            endTime: "06:00",
            days: [],
            ratePerKwh: 10,
            enabled: true,
            createdAt: "",
            updatedAt: "",
          }]),
      });
      const service = new StatsService(db);
      const result = await service.buildDayStats(
        "2026-03-01",
        0,
        undefined,
        false,
      );

      assertExists(result.tariffBreakdown);
      expect(result.tariffBreakdown[0].label).toBe("Off-Peak");
      expect(result.tariffBreakdown[0].gridWh).toBe(1000);
      expect(result.tariffBreakdown[0].costCents).toBe(100);
    });
  });
});
