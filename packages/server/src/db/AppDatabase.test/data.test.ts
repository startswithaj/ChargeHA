import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertExists } from "@std/assert";
import { expect } from "@std/expect";
import { AppDatabase } from "../AppDatabase.ts";
import type {
  CreateScheduleInput,
  PluginLogInput,
  VehicleChargeReadingInput,
  VehiclePollLogInput,
} from "../types.ts";
import type { ConfigKey } from "@chargeha/shared/schemas";

describe("AppDatabase", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
  });

  afterEach(() => {
    db.close();
  });

  describe("secrets", () => {
    it("setSecret and getSecret round-trip with isEncrypted=false", async () => {
      await db.setSecret(
        "tesla_client_secret" as ConfigKey,
        "plain_value",
        false,
      );
      const result = await db.getSecret("tesla_client_secret" as ConfigKey);
      assertExists(result);
      expect(result.value).toBe("plain_value");
      expect(result.isEncrypted).toBe(false);
    });

    it("setSecret and getSecret round-trip with isEncrypted=true", async () => {
      await db.setSecret(
        "tesla_client_secret" as ConfigKey,
        "encrypted_value",
        true,
      );
      const result = await db.getSecret("tesla_client_secret" as ConfigKey);
      assertExists(result);
      expect(result.value).toBe("encrypted_value");
      expect(result.isEncrypted).toBe(true);
    });

    it("getSecret returns null for missing key", async () => {
      const result = await db.getSecret("nonexistent" as ConfigKey);
      expect(result).toBeNull();
    });

    it("setSecret upserts existing key", async () => {
      await db.setSecret(
        "tesla_client_secret" as ConfigKey,
        "old_value",
        false,
      );
      await db.setSecret(
        "tesla_client_secret" as ConfigKey,
        "new_value",
        true,
      );
      const result = await db.getSecret("tesla_client_secret" as ConfigKey);
      assertExists(result);
      expect(result.value).toBe("new_value");
      expect(result.isEncrypted).toBe(true);
    });

    it("hasEncryptedRows returns false when no encrypted rows", async () => {
      expect(await db.hasEncryptedRows()).toBe(false);
    });

    it("hasEncryptedRows returns true when encrypted rows exist", async () => {
      await db.setSecret(
        "tesla_client_secret" as ConfigKey,
        "secret",
        true,
      );
      expect(await db.hasEncryptedRows()).toBe(true);
    });

    it("hasEncryptedRows returns false when only non-encrypted rows exist", async () => {
      await db.setSecret(
        "tesla_client_secret" as ConfigKey,
        "plain",
        false,
      );
      expect(await db.hasEncryptedRows()).toBe(false);
    });
  });

  describe("vehicle priorities", () => {
    it("getNextVehiclePriority returns 1 when no vehicles", async () => {
      const next = await db.getNextVehiclePriority();
      expect(next).toBe(1);
    });

    it("getNextVehiclePriority returns max+1", async () => {
      await db.upsertVehicle({
        id: "V1",
        name: "Car 1",
        adapterType: "tesla",
        priority: 3,
        config: "{}",
        mode: "auto",
      });
      await db.upsertVehicle({
        id: "V2",
        name: "Car 2",
        adapterType: "tesla",
        priority: 7,
        config: "{}",
        mode: "auto",
      });

      const next = await db.getNextVehiclePriority();
      expect(next).toBe(8);
    });

    it("resequenceVehiclePriorities fills gaps", async () => {
      await db.upsertVehicle({
        id: "V1",
        name: "Car 1",
        adapterType: "tesla",
        priority: 5,
        config: "{}",
        mode: "auto",
      });
      await db.upsertVehicle({
        id: "V2",
        name: "Car 2",
        adapterType: "tesla",
        priority: 10,
        config: "{}",
        mode: "auto",
      });

      await db.resequenceVehiclePriorities();

      const vehicles = await db.getVehicles();
      expect(vehicles[0].priority).toBe(1);
      expect(vehicles[1].priority).toBe(2);
    });
  });

  describe("schedules", () => {
    const sampleSchedule: CreateScheduleInput = {
      id: "sched-1",
      vehicleId: "VIN1",
      scheduleType: "charge",
      startTime: "22:00",
      endTime: "06:00",
      days: ["mon", "tue", "wed", "thu", "fri"],
      chargeAmps: 16,
      chargeLimitPct: 80,
    };

    it("returns empty list when no schedules", async () => {
      expect(await db.getSchedules()).toEqual([]);
    });

    it("creates and retrieves a schedule", async () => {
      await db.createSchedule(sampleSchedule);

      const schedule = await db.getSchedule("sched-1");
      assertExists(schedule);
      expect(schedule.id).toBe("sched-1");
      expect(schedule.vehicleId).toBe("VIN1");
      expect(schedule.scheduleType).toBe("charge");
      expect(schedule.startTime).toBe("22:00");
      expect(schedule.endTime).toBe("06:00");
      expect(schedule.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
      expect(schedule.chargeAmps).toBe(16);
      expect(schedule.chargeLimitPct).toBe(80);
      expect(schedule.enabled).toBe(true);
    });

    it("getSchedule returns null for missing id", async () => {
      expect(await db.getSchedule("nonexistent")).toBeNull();
    });

    it("getSchedules returns all schedules ordered by createdAt", async () => {
      await db.createSchedule(sampleSchedule);
      await db.createSchedule({
        ...sampleSchedule,
        id: "sched-2",
        startTime: "06:00",
        endTime: "14:00",
      });

      const schedules = await db.getSchedules();
      expect(schedules).toHaveLength(2);
      expect(schedules[0].id).toBe("sched-1");
      expect(schedules[1].id).toBe("sched-2");
    });

    it("creates schedule with enabled=false", async () => {
      await db.createSchedule({ ...sampleSchedule, enabled: false });

      const schedule = await db.getSchedule("sched-1");
      assertExists(schedule);
      expect(schedule.enabled).toBe(false);
    });

    it("creates schedule with null vehicleId", async () => {
      await db.createSchedule({ ...sampleSchedule, vehicleId: null });

      const schedule = await db.getSchedule("sched-1");
      assertExists(schedule);
      expect(schedule.vehicleId).toBeNull();
    });

    it("updates schedule fields partially", async () => {
      await db.createSchedule(sampleSchedule);

      await db.updateSchedule("sched-1", {
        startTime: "23:00",
        chargeAmps: 32,
        enabled: false,
      });

      const schedule = await db.getSchedule("sched-1");
      assertExists(schedule);
      expect(schedule.startTime).toBe("23:00");
      expect(schedule.chargeAmps).toBe(32);
      expect(schedule.enabled).toBe(false);
      // Unchanged fields remain
      expect(schedule.endTime).toBe("06:00");
      expect(schedule.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    });

    it("updateSchedule with empty input is a no-op", async () => {
      await db.createSchedule(sampleSchedule);
      await db.updateSchedule("sched-1", {});

      const schedule = await db.getSchedule("sched-1");
      assertExists(schedule);
      expect(schedule.chargeAmps).toBe(16);
    });

    it("updates schedule days", async () => {
      await db.createSchedule(sampleSchedule);
      await db.updateSchedule("sched-1", { days: ["sat", "sun"] });

      const schedule = await db.getSchedule("sched-1");
      assertExists(schedule);
      expect(schedule.days).toEqual(["sat", "sun"]);
    });

    it("deletes a schedule", async () => {
      await db.createSchedule(sampleSchedule);
      await db.deleteSchedule("sched-1");
      expect(await db.getSchedule("sched-1")).toBeNull();
    });

    it("deleteSchedulesByVehicle removes all schedules for a vehicle", async () => {
      await db.createSchedule(sampleSchedule);
      await db.createSchedule({
        ...sampleSchedule,
        id: "sched-2",
        vehicleId: "VIN1",
      });
      await db.createSchedule({
        ...sampleSchedule,
        id: "sched-3",
        vehicleId: "VIN2",
      });

      await db.deleteSchedulesByVehicle("VIN1");

      const schedules = await db.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].id).toBe("sched-3");
    });
  });

  describe("vehicle charge readings", () => {
    const sampleReading: VehicleChargeReadingInput = {
      vehicleId: "VIN1",
      chargePowerW: 7000,
      chargeAmps: 32,
      batteryLevel: 65,
      solarContributionW: 5000,
      gridContributionW: 2000,
      isHome: true,
      ratePerKwh: 25.5,
    };

    it("inserts and retrieves a vehicle charge reading", async () => {
      await db.insertVehicleChargeReading(sampleReading);

      const { rows, total } = await db.vehicles
        .getVehicleChargeReadingsPaginated({
          limit: 10,
          offset: 0,
        });
      expect(total).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].vehicleId).toBe("VIN1");
      expect(rows[0].chargePowerW).toBe(7000);
      expect(rows[0].chargeAmps).toBe(32);
      expect(rows[0].batteryLevel).toBe(65);
      expect(rows[0].solarContributionW).toBe(5000);
      expect(rows[0].gridContributionW).toBe(2000);
      expect(rows[0].isHome).toBe(true);
      expect(rows[0].ratePerKwh).toBe(25.5);
    });

    it("correctly stores isHome=false", async () => {
      await db.insertVehicleChargeReading({
        ...sampleReading,
        isHome: false,
      });

      const { rows } = await db.vehicles.getVehicleChargeReadingsPaginated({
        limit: 10,
        offset: 0,
      });
      expect(rows[0].isHome).toBe(false);
    });

    it("stores null ratePerKwh", async () => {
      await db.insertVehicleChargeReading({
        ...sampleReading,
        ratePerKwh: null,
      });

      const { rows } = await db.vehicles.getVehicleChargeReadingsPaginated({
        limit: 10,
        offset: 0,
      });
      expect(rows[0].ratePerKwh).toBeNull();
    });
  });

  describe("vehicle poll logs", () => {
    const samplePollLog: VehiclePollLogInput = {
      vehicleId: "VIN1",
      vehicleName: "Model 3",
      isOnline: true,
      isPluggedIn: true,
      isCharging: false,
      batteryLevel: 72,
      chargeLimit: 80,
      chargeAmps: 16,
      chargeAmpsMax: 32,
      chargePowerKw: 0,
      chargerVoltage: 240,
      energyAddedKwh: 5.2,
      minutesToFull: 120,
      isHome: true,
    };

    it("inserts and retrieves a vehicle poll log", async () => {
      await db.insertVehiclePollLog(samplePollLog);

      const { rows, total } = await db.logs.getVehiclePollLogsPaginated({
        limit: 10,
        offset: 0,
      });
      expect(total).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].vehicleId).toBe("VIN1");
      expect(rows[0].vehicleName).toBe("Model 3");
      expect(rows[0].isOnline).toBe(true);
      expect(rows[0].isPluggedIn).toBe(true);
      expect(rows[0].isCharging).toBe(false);
      expect(rows[0].batteryLevel).toBe(72);
      expect(rows[0].chargeLimit).toBe(80);
      expect(rows[0].chargeAmps).toBe(16);
      expect(rows[0].chargeAmpsMax).toBe(32);
      expect(rows[0].chargePowerKw).toBe(0);
      expect(rows[0].chargerVoltage).toBe(240);
      expect(rows[0].energyAddedKwh).toBe(5.2);
      expect(rows[0].minutesToFull).toBe(120);
    });

    it("correctly maps boolean fields", async () => {
      await db.insertVehiclePollLog({
        ...samplePollLog,
        isOnline: false,
        isPluggedIn: false,
        isCharging: false,
      });

      const { rows } = await db.logs.getVehiclePollLogsPaginated({
        limit: 10,
        offset: 0,
      });
      expect(rows[0].isOnline).toBe(false);
      expect(rows[0].isPluggedIn).toBe(false);
      expect(rows[0].isCharging).toBe(false);
    });
  });

  describe("plugin logs", () => {
    const samplePluginLog: PluginLogInput = {
      pluginId: "solar-adapter",
      level: "info",
      message: "Polling solar inverter",
      payload: JSON.stringify({ watts: 5000 }),
      origin: "poll",
    };

    it("inserts and retrieves plugin logs with pagination", async () => {
      await db.insertPluginLog(samplePluginLog);
      await db.insertPluginLog({ ...samplePluginLog, message: "second" });
      await db.insertPluginLog({ ...samplePluginLog, message: "third" });

      const page1 = await db.logs.getPluginLogs({ limit: 2, offset: 0 });
      expect(page1.total).toBe(3);
      expect(page1.rows).toHaveLength(2);

      const page2 = await db.logs.getPluginLogs({ limit: 2, offset: 2 });
      expect(page2.total).toBe(3);
      expect(page2.rows).toHaveLength(1);
    });

    it("filters by pluginId", async () => {
      await db.insertPluginLog(samplePluginLog);
      await db.insertPluginLog({
        ...samplePluginLog,
        pluginId: "vehicle-adapter",
      });

      const { rows, total } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        pluginId: "solar-adapter",
      });
      expect(total).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].pluginId).toBe("solar-adapter");
    });

    it("filters by from date", async () => {
      await db.insertPluginLog(samplePluginLog);

      const { total } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        from: "2099-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        from: "2000-01-01T00:00:00",
      });
      expect(total2).toBe(1);
    });

    it("filters by to date", async () => {
      await db.insertPluginLog(samplePluginLog);

      const { total } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        to: "2000-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        to: "2099-01-01T00:00:00",
      });
      expect(total2).toBe(1);
    });

    it("filters by level", async () => {
      await db.insertPluginLog(samplePluginLog);
      await db.insertPluginLog({ ...samplePluginLog, level: "warn" });
      await db.insertPluginLog({ ...samplePluginLog, level: "error" });

      const { rows, total } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        level: ["error"],
      });
      expect(total).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].level).toBe("error");
    });

    it("filters by origin", async () => {
      await db.insertPluginLog(samplePluginLog);
      await db.insertPluginLog({ ...samplePluginLog, origin: "startup" });

      const { rows, total } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        origin: "startup",
      });
      expect(total).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].origin).toBe("startup");
    });

    it("search supports `-term` to exclude matching rows", async () => {
      // Tesla has a high-volume `controller:online-check` polling log;
      // users need to exclude it with `-online-check` to read other logs.
      await db.insertPluginLog({
        ...samplePluginLog,
        message: "Vehicle came online",
        origin: "controller:tick",
      });
      await db.insertPluginLog({
        ...samplePluginLog,
        message: "isVehicleOnline",
        origin: "controller:online-check",
      });
      await db.insertPluginLog({
        ...samplePluginLog,
        message: "Wake failed",
        origin: "controller:wake",
      });

      const { rows, total } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        search: "-online-check",
      });
      expect(total).toBe(2);
      expect(rows.map((r) => r.origin).sort()).toEqual([
        "controller:tick",
        "controller:wake",
      ]);
    });

    it("search combines an include phrase with `-term` excludes", async () => {
      await db.insertPluginLog({
        ...samplePluginLog,
        message: "tesla wake ok",
        origin: "controller:wake",
      });
      await db.insertPluginLog({
        ...samplePluginLog,
        message: "tesla online check",
        origin: "controller:online-check",
      });
      await db.insertPluginLog({
        ...samplePluginLog,
        message: "solar reading",
        origin: "poll",
      });

      const { rows, total } = await db.logs.getPluginLogs({
        limit: 10,
        offset: 0,
        search: "tesla -online-check",
      });
      expect(total).toBe(1);
      expect(rows[0].origin).toBe("controller:wake");
    });
  });
});
