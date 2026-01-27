import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertExists } from "@std/assert";
import { expect } from "@std/expect";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import { StatsService } from "../../services/StatsService.ts";
import type { TrpcContext } from "../trpc.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Stats tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);
  let db: AppDatabase;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", {
      db,
      statsService: new StatsService(db),
      encryptionKey: null,
    }));
  });

  afterEach(() => {
    db.close();
  });

  // R1 (audit-flagged): insertReading / insertEnergyReading back-date rows via
  // (db as any).sqlite. Skipped pending public AppDatabase
  // `insert*WithTimestamp` helpers — see progress.txt US-047 notes.
  const insertReading = async (
    db: AppDatabase,
    opts: {
      timestamp: string;
      vehicleId?: string;
      solarW?: number;
      gridW?: number;
      rateCents?: number | null;
    },
  ): Promise<void> => {
    const solar = opts.solarW ?? 0;
    const grid = opts.gridW ?? 0;
    await db.insertVehicleChargeReading({
      vehicleId: opts.vehicleId ?? "VIN123",
      chargePowerW: solar + grid,
      chargeAmps: 10,
      batteryLevel: 50,
      solarContributionW: solar,
      gridContributionW: grid,
      isHome: true,
      ratePerKwh: opts.rateCents ?? null,
    });
    // deno-lint-ignore no-explicit-any
    const sqlite = (db as any).sqlite;
    const idRows = sqlite.prepare(
      "SELECT id FROM vehicle_charge_readings ORDER BY id DESC LIMIT 1",
    ).all() as Array<{ id: number }>;
    const id = idRows[0].id;
    sqlite.prepare(
      "UPDATE vehicle_charge_readings SET timestamp = ? WHERE id = ?",
    ).run(opts.timestamp, id);
  };

  const insertEnergyReading = async (
    db: AppDatabase,
    opts: {
      timestamp: string;
      solarW?: number;
      gridW?: number;
      homeW?: number;
      rateCents?: number | null;
    },
  ): Promise<void> => {
    const solar = opts.solarW ?? 0;
    const grid = opts.gridW ?? 0;
    const home = opts.homeW ?? (solar + Math.max(grid, 0));
    await db.insertEnergyReading(
      {
        solarProductionW: solar,
        gridPowerW: grid,
        homeConsumptionW: home,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      },
      opts.rateCents ?? null,
    );
    // deno-lint-ignore no-explicit-any
    const sqlite = (db as any).sqlite;
    const idRows = sqlite.prepare(
      "SELECT id FROM energy_readings ORDER BY id DESC LIMIT 1",
    ).all() as Array<{ id: number }>;
    const id = idRows[0].id;
    sqlite.prepare(
      "UPDATE energy_readings SET timestamp = ? WHERE id = ?",
    ).run(opts.timestamp, id);
  };

  describe("stats.day", () => {
    it("returns 24 hourly buckets for a day", async () => {
      const data = await caller.stats.day({ date: "2026-03-01" });

      expect(data.period).toBe("day");
      expect(data.startDate).toBe("2026-03-01");
      expect(data.endDate).toBe("2026-03-01");
      expect(data.buckets).toHaveLength(24);
      expect(data.energyBuckets).toHaveLength(24);
    });

    it("returns 96 buckets with 15m resolution", async () => {
      const data = await caller.stats.day({
        date: "2026-03-01",
        resolution: "15m",
      });

      expect(data.buckets).toHaveLength(96);
      expect(data.energyBuckets).toHaveLength(96);
    });

    it("applies timezone offset", async () => {
      const data = await caller.stats.day({ date: "2026-03-01", tz: 11 });

      expect(data.buckets).toHaveLength(24);
    });

    it("includes summary totals", async () => {
      const data = await caller.stats.day({ date: "2026-03-01" });

      expect(data.totalChargedWh).toBeDefined();
      expect(data.totalSolarWh).toBeDefined();
      expect(data.totalGridWh).toBeDefined();
      expect(data.totalAwayWh).toBeDefined();
      expect(data.selfPoweredPercent).toBeDefined();
      expect(data.homeSolarProductionWh).toBeDefined();
      expect(data.homeConsumedWh).toBeDefined();
      expect(data.homeSelfPoweredPercent).toBeDefined();
    });
  });

  describe("stats.month", () => {
    it("returns daily buckets for a month", async () => {
      const data = await caller.stats.month({ year: 2026, month: 3 });

      expect(data.period).toBe("month");
      expect(data.buckets).toHaveLength(31); // March has 31 days
      expect(data.energyBuckets).toHaveLength(31);
    });

    it("returns correct days for February", async () => {
      const data = await caller.stats.month({ year: 2026, month: 2 });
      expect(data.buckets).toHaveLength(28); // 2026 is not a leap year
    });

    it("includes solar production line", async () => {
      const data = await caller.stats.month({ year: 2026, month: 3 });
      expect(data.solarProductionLine).toBeDefined();
      expect(Array.isArray(data.solarProductionLine)).toBe(true);
    });
  });

  describe("stats.year", () => {
    it("returns 12 monthly buckets", async () => {
      const data = await caller.stats.year({ year: 2026 });

      expect(data.period).toBe("year");
      expect(data.buckets).toHaveLength(12);
      expect(data.energyBuckets).toHaveLength(12);
      expect(data.startDate).toBe("2026-01-01");
      expect(data.endDate).toBe("2026-12-31");
    });

    it("returns month labels", async () => {
      const data = await caller.stats.year({ year: 2026 });
      expect(data.buckets[0].label).toBe("Jan");
      expect(data.buckets[11].label).toBe("Dec");
    });
  });

  describe("Cost data", () => {
    it("includes cost fields with default currency", async () => {
      const data = await caller.stats.day({ date: "2026-03-01" });

      expect(data.totalCostCents).toBeDefined();
      expect(data.solarSavingsCents).toBeDefined();
      expect(data.currencySymbol).toBe("$");
      expect(data.currencyCode).toBe("AUD");
    });

    it("returns zero cost when no readings have rates", async () => {
      await insertReading(db, {
        timestamp: "2026-03-01 10:00:00",
        gridW: 3000,
        solarW: 1000,
        rateCents: null,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      expect(data.totalCostCents).toBe(0);
      expect(data.solarSavingsCents).toBe(0);
    });

    it("computes per-bucket costCents from grid usage and rate", async () => {
      await insertReading(db, {
        timestamp: "2026-03-01 10:00:00",
        gridW: 6000,
        solarW: 0,
        rateCents: 30,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      const bucket10 = data.buckets[10];
      expect(bucket10.costCents).toBeCloseTo(300, 1);
      expect(data.totalCostCents).toBeCloseTo(300, 1);
    });

    it("computes solarSavingsCents from solar usage and rate", async () => {
      await insertReading(db, {
        timestamp: "2026-03-01 14:00:00",
        gridW: 1000,
        solarW: 3000,
        rateCents: 20,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      expect(data.solarSavingsCents).toBeCloseTo(100, 1);
    });

    it("includes cost data in month responses", async () => {
      await insertReading(db, {
        timestamp: "2026-03-15 10:00:00",
        gridW: 6000,
        solarW: 3000,
        rateCents: 30,
      });

      const data = await caller.stats.month({ year: 2026, month: 3 });

      expect(data.totalCostCents).toBeCloseTo(300, 1);
      expect(data.solarSavingsCents).toBeCloseTo(150, 1);
      expect(data.currencySymbol).toBe("$");
      const bucket15 = data.buckets[14]; // 0-indexed, day 15 is index 14
      expect(bucket15.costCents).toBeCloseTo(300, 1);
    });

    it("includes cost data in year responses", async () => {
      await insertReading(db, {
        timestamp: "2026-03-15 10:00:00",
        gridW: 6000,
        solarW: 0,
        rateCents: 30,
      });

      const data = await caller.stats.year({ year: 2026 });

      expect(data.totalCostCents).toBeCloseTo(300, 1);
      expect(data.buckets[2].costCents).toBeCloseTo(300, 1);
    });

    it("uses configured currency from DB", async () => {
      await db.setConfig("currency_symbol", "€");
      await db.setConfig("currency_code", "EUR");

      const data = await caller.stats.day({ date: "2026-03-01" });

      expect(data.currencySymbol).toBe("€");
      expect(data.currencyCode).toBe("EUR");
    });
  });

  describe("Tariff breakdown", () => {
    it("includes tariff breakdown grouped by rate", async () => {
      await insertEnergyReading(db, {
        timestamp: "2026-03-01 02:00:00",
        gridW: 6000,
        solarW: 0,
        rateCents: 10,
      });
      await insertEnergyReading(db, {
        timestamp: "2026-03-01 14:00:00",
        gridW: 6000,
        solarW: 0,
        rateCents: 40,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      assertExists(data.tariffBreakdown);
      expect(data.tariffBreakdown).toHaveLength(2);
      expect(data.tariffBreakdown[0].ratePerKwh).toBe(10);
      expect(data.tariffBreakdown[1].ratePerKwh).toBe(40);
      expect(data.tariffBreakdown[0].costCents).toBeCloseTo(100, 1);
      expect(data.tariffBreakdown[1].costCents).toBeCloseTo(400, 1);
    });

    it("maps rates to tariff period labels", async () => {
      await db.createTariffPeriod({
        label: "Off-Peak",
        startTime: "00:00",
        endTime: "06:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 10,
        enabled: true,
      });
      await db.createTariffPeriod({
        label: "Peak",
        startTime: "14:00",
        endTime: "20:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ratePerKwh: 40,
        enabled: true,
      });

      await insertEnergyReading(db, {
        timestamp: "2026-03-01 02:00:00",
        gridW: 6000,
        solarW: 0,
        rateCents: 10,
      });
      await insertEnergyReading(db, {
        timestamp: "2026-03-01 15:00:00",
        gridW: 6000,
        solarW: 0,
        rateCents: 40,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      assertExists(data.tariffBreakdown);
      expect(data.tariffBreakdown[0].label).toBe("Off-Peak");
      expect(data.tariffBreakdown[1].label).toBe("Peak");
    });

    it("omits tariff breakdown when no rated readings exist", async () => {
      await insertReading(db, {
        timestamp: "2026-03-01 10:00:00",
        gridW: 6000,
        solarW: 0,
        rateCents: null,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      expect(data.tariffBreakdown).toBeUndefined();
    });
  });

  describe("Vehicle SoC in day stats", () => {
    /** Insert a vehicle poll log at a specific UTC timestamp. */
    async function insertPollLog(
      db: AppDatabase,
      opts: {
        timestamp: string;
        vehicleId: string;
        vehicleName: string;
        batteryLevel: number;
      },
    ): Promise<void> {
      await db.insertVehiclePollLog({
        vehicleId: opts.vehicleId,
        vehicleName: opts.vehicleName,
        isOnline: true,
        isPluggedIn: true,
        isCharging: false,
        batteryLevel: opts.batteryLevel,
        chargeLimit: 80,
        chargeAmps: 0,
        chargeAmpsMax: 16,
        chargePowerKw: 0,
        chargerVoltage: 240,
        energyAddedKwh: 0,
        minutesToFull: 0,
        isHome: true,
      });
      // deno-lint-ignore no-explicit-any
      const sqlite = (db as any).sqlite;
      const idRows = sqlite.prepare(
        "SELECT id FROM vehicle_poll_logs ORDER BY id DESC LIMIT 1",
      ).all() as Array<{ id: number }>;
      const id = idRows[0].id;
      sqlite.prepare(
        "UPDATE vehicle_poll_logs SET timestamp = ? WHERE id = ?",
      ).run(opts.timestamp, id);
    }

    it("returns vehicleSoc when poll logs exist (1h)", async () => {
      await insertPollLog(db, {
        timestamp: "2026-03-01 10:30:00",
        vehicleId: "VIN_A",
        vehicleName: "Model 3",
        batteryLevel: 70,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      assertExists(data.vehicleSoc);
      expect(data.vehicleSoc).toHaveLength(24);
      // Bucket 10 (hour 10) should have the snapshot since the log is at 10:30
      const bucket10 = data.vehicleSoc[10];
      expect(bucket10).toHaveLength(1);
      expect(bucket10[0].vehicleId).toBe("VIN_A");
      expect(bucket10[0].vehicleName).toBe("Model 3");
      expect(bucket10[0].batteryLevel).toBe(70);
    });

    it("carries forward SoC to subsequent buckets", async () => {
      await insertPollLog(db, {
        timestamp: "2026-03-01 08:00:00",
        vehicleId: "VIN_A",
        vehicleName: "Model 3",
        batteryLevel: 50,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      assertExists(data.vehicleSoc);
      // Bucket 8 has the log
      expect(data.vehicleSoc[8][0].batteryLevel).toBe(50);
      // Bucket 12 should carry forward (no new data but vehicle still has 50%)
      expect(data.vehicleSoc[12][0].batteryLevel).toBe(50);
      // Bucket 7 (before the log) should have no vehicles
      expect(data.vehicleSoc[7]).toHaveLength(0);
    });

    it("tracks multiple vehicles independently", async () => {
      await insertPollLog(db, {
        timestamp: "2026-03-01 09:00:00",
        vehicleId: "VIN_A",
        vehicleName: "Model 3",
        batteryLevel: 60,
      });
      await insertPollLog(db, {
        timestamp: "2026-03-01 10:00:00",
        vehicleId: "VIN_B",
        vehicleName: "Model Y",
        batteryLevel: 80,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      assertExists(data.vehicleSoc);
      // Bucket 9: only VIN_A
      expect(data.vehicleSoc[9]).toHaveLength(1);
      expect(data.vehicleSoc[9][0].vehicleId).toBe("VIN_A");
      // Bucket 10: both vehicles
      expect(data.vehicleSoc[10]).toHaveLength(2);
    });

    it("updates SoC when new poll log arrives in later bucket", async () => {
      await insertPollLog(db, {
        timestamp: "2026-03-01 08:00:00",
        vehicleId: "VIN_A",
        vehicleName: "Model 3",
        batteryLevel: 50,
      });
      await insertPollLog(db, {
        timestamp: "2026-03-01 12:00:00",
        vehicleId: "VIN_A",
        vehicleName: "Model 3",
        batteryLevel: 75,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      assertExists(data.vehicleSoc);
      expect(data.vehicleSoc[8][0].batteryLevel).toBe(50);
      expect(data.vehicleSoc[11][0].batteryLevel).toBe(50);
      expect(data.vehicleSoc[12][0].batteryLevel).toBe(75);
    });

    it("returns vehicleSoc with 15m resolution", async () => {
      await insertPollLog(db, {
        timestamp: "2026-03-01 10:30:00",
        vehicleId: "VIN_A",
        vehicleName: "Model 3",
        batteryLevel: 65,
      });

      const data = await caller.stats.day({
        date: "2026-03-01",
        resolution: "15m",
      });

      assertExists(data.vehicleSoc);
      expect(data.vehicleSoc).toHaveLength(96);
      // 10:30 → bucket 42 (10*4 + 30/15 = 42)
      expect(data.vehicleSoc[42][0].batteryLevel).toBe(65);
      // Bucket 40 (10:00) should be empty — before the log
      expect(data.vehicleSoc[40]).toHaveLength(0);
    });

    it("omits vehicleSoc when no poll logs exist", async () => {
      const data = await caller.stats.day({ date: "2026-03-01" });
      expect(data.vehicleSoc).toBeUndefined();
    });
  });

  describe("Energy bucket costCents", () => {
    it("computes per-bucket energy costCents from grid import and rate", async () => {
      await insertEnergyReading(db, {
        timestamp: "2026-03-01 10:00:00",
        solarW: 0,
        gridW: 6000,
        homeW: 6000,
        rateCents: 30,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      const bucket10 = data.energyBuckets[10];
      expect(bucket10.costCents).toBeCloseTo(300, 1);
    });

    it("returns zero energy costCents when rate is null", async () => {
      await insertEnergyReading(db, {
        timestamp: "2026-03-01 10:00:00",
        solarW: 0,
        gridW: 6000,
        homeW: 6000,
        rateCents: null,
      });

      const data = await caller.stats.day({ date: "2026-03-01" });

      const bucket10 = data.energyBuckets[10];
      expect(bucket10.costCents).toBe(0);
    });

    it("includes energy costCents in 15m resolution", async () => {
      await insertEnergyReading(db, {
        timestamp: "2026-03-01 10:00:00",
        solarW: 0,
        gridW: 6000,
        homeW: 6000,
        rateCents: 30,
      });

      const data = await caller.stats.day({
        date: "2026-03-01",
        resolution: "15m",
      });

      const bucket40 = data.energyBuckets[40];
      expect(bucket40.costCents).toBeCloseTo(300, 1);
    });
  });
});
