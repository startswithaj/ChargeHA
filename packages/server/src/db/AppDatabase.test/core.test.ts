import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertExists } from "@std/assert";
import { expect } from "@std/expect";
import { AppDatabase } from "../AppDatabase.ts";
import type { ControllerLogInput } from "../types.ts";

describe("AppDatabase", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
  });

  afterEach(() => {
    db.close();
  });

  describe("init", () => {
    it("creates all tables without error", async () => {
      // init() already called in beforeEach — just verify we can query tables
      const readings = await db.getRecentReadings(1);
      expect(readings).toEqual([]);
    });
  });

  describe("energy readings", () => {
    it("inserts and retrieves energy readings", async () => {
      await db.insertEnergyReading({
        solarProductionW: 5000,
        gridPowerW: -1200,
        homeConsumptionW: 3800,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });

      const readings = await db.getRecentReadings(10);
      expect(readings).toHaveLength(1);
      expect(readings[0].solarProductionW).toBe(5000);
      expect(readings[0].gridPowerW).toBe(-1200);
      expect(readings[0].homeConsumptionW).toBe(3800);
      expect(readings[0].batteryPowerW).toBeNull();
      expect(readings[0].batterySoc).toBeNull();
    });

    it("returns readings in chronological order (oldest first)", async () => {
      await db.insertEnergyReading({
        solarProductionW: 1000,
        gridPowerW: 0,
        homeConsumptionW: 1000,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });
      await db.insertEnergyReading({
        solarProductionW: 2000,
        gridPowerW: 0,
        homeConsumptionW: 2000,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });

      const readings = await db.getRecentReadings(10);
      expect(readings).toHaveLength(2);
      expect(readings[0].solarProductionW).toBe(1000);
      expect(readings[1].solarProductionW).toBe(2000);
    });

    it("respects the limit parameter", async () => {
      await Array.from({ length: 5 }).reduce(async (prev, _, i) => {
        await prev;
        await db.insertEnergyReading({
          solarProductionW: i * 1000,
          gridPowerW: 0,
          homeConsumptionW: 0,
          batteryPowerW: null,
          batterySoc: null,
          gridVoltageV: null,
          lastUpdated: "2024-01-01T00:00:00.000Z",
        });
      }, Promise.resolve());

      const readings = await db.getRecentReadings(3);
      expect(readings).toHaveLength(3);
      // Should get the 3 most recent, in chronological order
      expect(readings[0].solarProductionW).toBe(2000);
      expect(readings[2].solarProductionW).toBe(4000);
    });

    it("includes battery data when present", async () => {
      await db.insertEnergyReading({
        solarProductionW: 5000,
        gridPowerW: 0,
        homeConsumptionW: 3000,
        batteryPowerW: -2000,
        batterySoc: 75.5,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });

      const readings = await db.getRecentReadings(1);
      expect(readings[0].batteryPowerW).toBe(-2000);
      expect(readings[0].batterySoc).toBe(75.5);
    });
  });

  describe("config", () => {
    it("returns null for missing config key", async () => {
      expect(await db.getPluginConfig("nonexistent")).toBeNull();
    });

    it("stores and retrieves config values", async () => {
      await db.setPluginConfig("test_key", "test_value");
      expect(await db.getPluginConfig("test_key")).toBe("test_value");
    });

    it("overwrites existing config values", async () => {
      await db.setPluginConfig("key", "value1");
      await db.setPluginConfig("key", "value2");
      expect(await db.getPluginConfig("key")).toBe("value2");
    });
  });

  describe("vehicles", () => {
    it("returns empty list when no vehicles", async () => {
      expect(await db.getVehicles()).toEqual([]);
    });

    it("upserts and retrieves a vehicle", async () => {
      await db.upsertVehicle({
        id: "VIN123",
        name: "Model 3",
        adapterType: "tesla",
        priority: 1,
        config: JSON.stringify({ region: "na" }),
        mode: "auto",
      });

      const vehicle = await db.getVehicle("VIN123");
      assertExists(vehicle);
      expect(vehicle.id).toBe("VIN123");
      expect(vehicle.name).toBe("Model 3");
      expect(vehicle.adapterType).toBe("tesla");
      expect(vehicle.config).toBe(JSON.stringify({ region: "na" }));
    });

    it("lists all vehicles", async () => {
      await db.upsertVehicle({
        id: "VIN1",
        name: "Car 1",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });
      await db.upsertVehicle({
        id: "VIN2",
        name: "Car 2",
        adapterType: "tesla",
        priority: 2,
        config: "{}",
        mode: "auto",
      });

      const vehicles = await db.getVehicles();
      expect(vehicles).toHaveLength(2);
    });

    it("returns null for missing vehicle", async () => {
      expect(await db.getVehicle("NONEXISTENT")).toBeNull();
    });

    it("updates existing vehicle on upsert", async () => {
      await db.upsertVehicle({
        id: "VIN1",
        name: "Old Name",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });
      await db.upsertVehicle({
        id: "VIN1",
        name: "New Name",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });

      const vehicle = await db.getVehicle("VIN1");
      assertExists(vehicle);
      expect(vehicle.name).toBe("New Name");
    });

    it("deletes a vehicle", async () => {
      await db.upsertVehicle({
        id: "VIN1",
        name: "Car 1",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });

      await db.deleteVehicle("VIN1");
      expect(await db.getVehicle("VIN1")).toBeNull();
    });

    it("updates vehicle mode", async () => {
      await db.upsertVehicle({
        id: "VIN1",
        name: "Car 1",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });

      await db.updateVehicleMode("VIN1", "charge_now");
      const vehicle = await db.getVehicle("VIN1");
      assertExists(vehicle);
      expect(vehicle.mode).toBe("charge_now");
    });

    it("updates vehicle priority", async () => {
      await db.upsertVehicle({
        id: "VIN1",
        name: "Car 1",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });

      await db.updateVehiclePriority("VIN1", 5);
      const vehicle = await db.getVehicle("VIN1");
      assertExists(vehicle);
      expect(vehicle.priority).toBe(5);
    });

    it("orders vehicles by priority", async () => {
      await db.upsertVehicle({
        id: "VIN_LOW",
        name: "Low Priority",
        adapterType: "tesla",
        priority: 10,
        config: "{}",
        mode: "auto",
      });
      await db.upsertVehicle({
        id: "VIN_HIGH",
        name: "High Priority",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });

      const vehicles = await db.getVehicles();
      expect(vehicles[0].id).toBe("VIN_HIGH");
      expect(vehicles[1].id).toBe("VIN_LOW");
    });
  });

  describe("tariff periods", () => {
    it("seeds default config keys on init", async () => {
      expect(await db.getConfig("default_rate_per_kwh")).toBe("0");
      expect(await db.getConfig("currency_symbol")).toBe("$");
      expect(await db.getConfig("currency_code")).toBe("AUD");
    });

    it("does not overwrite existing config keys on re-init", async () => {
      await db.setConfig("default_rate_per_kwh", "30");
      await db.setConfig("currency_symbol", "€");
      await db.setConfig("currency_code", "EUR");
      await db.init();

      expect(await db.getConfig("default_rate_per_kwh")).toBe("30");
      expect(await db.getConfig("currency_symbol")).toBe("€");
      expect(await db.getConfig("currency_code")).toBe("EUR");
    });

    it("returns empty list when no tariff periods", async () => {
      expect(await db.getTariffPeriods()).toEqual([]);
    });

    it("creates and retrieves a tariff period", async () => {
      const id = await db.createTariffPeriod({
        label: "Off-Peak",
        startTime: "22:00",
        endTime: "06:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        ratePerKwh: 15.5,
      });

      expect(id).toBeGreaterThan(0);

      const period = await db.getTariffPeriod(id);
      assertExists(period);
      expect(period.label).toBe("Off-Peak");
      expect(period.startTime).toBe("22:00");
      expect(period.endTime).toBe("06:00");
      expect(period.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
      expect(period.ratePerKwh).toBe(15.5);
      expect(period.enabled).toBe(true);
    });

    it("lists all tariff periods ordered by start_time", async () => {
      await db.createTariffPeriod({
        label: "Peak",
        startTime: "14:00",
        endTime: "20:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        ratePerKwh: 45,
      });
      await db.createTariffPeriod({
        label: "Off-Peak",
        startTime: "06:00",
        endTime: "14:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        ratePerKwh: 15,
      });

      const periods = await db.getTariffPeriods();
      expect(periods).toHaveLength(2);
      expect(periods[0].label).toBe("Off-Peak");
      expect(periods[1].label).toBe("Peak");
    });

    it("updates a tariff period", async () => {
      const id = await db.createTariffPeriod({
        label: "Old Label",
        startTime: "00:00",
        endTime: "06:00",
        days: ["mon"],
        ratePerKwh: 10,
      });

      await db.updateTariffPeriod(id, {
        label: "New Label",
        ratePerKwh: 20,
        enabled: false,
      });

      const period = await db.getTariffPeriod(id);
      assertExists(period);
      expect(period.label).toBe("New Label");
      expect(period.ratePerKwh).toBe(20);
      expect(period.enabled).toBe(false);
      // Unchanged fields should remain
      expect(period.startTime).toBe("00:00");
      expect(period.days).toEqual(["mon"]);
    });

    it("deletes a tariff period", async () => {
      const id = await db.createTariffPeriod({
        label: "To Delete",
        startTime: "00:00",
        endTime: "06:00",
        days: ["mon"],
        ratePerKwh: 10,
      });

      await db.deleteTariffPeriod(id);
      expect(await db.getTariffPeriod(id)).toBeNull();
    });

    it("deletes all tariff periods", async () => {
      await db.createTariffPeriod({
        label: "Period 1",
        startTime: "00:00",
        endTime: "06:00",
        days: ["mon"],
        ratePerKwh: 10,
      });
      await db.createTariffPeriod({
        label: "Period 2",
        startTime: "06:00",
        endTime: "12:00",
        days: ["tue"],
        ratePerKwh: 20,
      });

      await db.deleteAllTariffPeriods();
      expect(await db.getTariffPeriods()).toEqual([]);
    });

    it("returns null for missing tariff period", async () => {
      expect(await db.getTariffPeriod(999)).toBeNull();
    });

    it("creates tariff period with enabled=false", async () => {
      const id = await db.createTariffPeriod({
        label: "Disabled",
        startTime: "00:00",
        endTime: "06:00",
        days: ["sat", "sun"],
        ratePerKwh: 5,
        enabled: false,
      });

      const period = await db.getTariffPeriod(id);
      assertExists(period);
      expect(period.enabled).toBe(false);
    });
  });

  describe("controller logs", () => {
    const sampleEntry: ControllerLogInput = {
      vehicleId: "VIN1",
      vehicleName: "Model 3",
      mode: "auto",
      inputsJson: JSON.stringify({ energy: null }),
      checksJson: JSON.stringify([{ check: "plugged_in", result: "yes" }]),
      action: "none",
      actionDetail: "Already charging",
      targetAmps: null,
      traceId: "test",
    };

    it("inserts and retrieves log entries", async () => {
      await db.insertControllerLogEntries([sampleEntry]);

      const { rows, total } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
      });
      expect(total).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].vehicleId).toBe("VIN1");
      expect(rows[0].vehicleName).toBe("Model 3");
      expect(rows[0].mode).toBe("auto");
      expect(rows[0].action).toBe("none");
      expect(rows[0].actionDetail).toBe("Already charging");
      expect(rows[0].targetAmps).toBeNull();
      expect(rows[0].timestamp).toBeDefined();
    });

    it("batch inserts multiple entries", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, vehicleId: "VIN1" },
        { ...sampleEntry, vehicleId: "VIN2" },
        { ...sampleEntry, vehicleId: "VIN3" },
      ]);

      const { total } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
      });
      expect(total).toBe(3);
    });

    it("returns entries newest first", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, actionDetail: "first" },
      ]);
      await db.insertControllerLogEntries([
        { ...sampleEntry, actionDetail: "second" },
      ]);

      const { rows } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
      });
      expect(rows[0].actionDetail).toBe("second");
      expect(rows[1].actionDetail).toBe("first");
    });

    it("filters by vehicleId", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, vehicleId: "VIN_A" },
        { ...sampleEntry, vehicleId: "VIN_B" },
        { ...sampleEntry, vehicleId: "VIN_A" },
      ]);

      const { rows, total } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
        vehicleId: "VIN_A",
      });
      expect(total).toBe(2);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.vehicleId === "VIN_A")).toBe(true);
    });

    it("paginates with limit and offset", async () => {
      await Array.from({ length: 5 }).reduce(async (prev, _, i) => {
        await prev;
        await db.insertControllerLogEntries([
          { ...sampleEntry, actionDetail: `entry-${i}` },
        ]);
      }, Promise.resolve());

      const page1 = await db.logs.getControllerLogs({ limit: 2, offset: 0 });
      expect(page1.rows).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = await db.logs.getControllerLogs({ limit: 2, offset: 2 });
      expect(page2.rows).toHaveLength(2);

      const page3 = await db.logs.getControllerLogs({ limit: 2, offset: 4 });
      expect(page3.rows).toHaveLength(1);
    });

    it("stores and returns targetAmps when set", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, action: "start", targetAmps: 12 },
      ]);

      const { rows } = await db.logs.getControllerLogs({ limit: 1, offset: 0 });
      expect(rows[0].targetAmps).toBe(12);
    });

    it("preserves JSON in inputsJson and checksJson", async () => {
      const inputs = { energy: { solarProductionW: 5000, gridPowerW: -200 } };
      const checks = [
        { check: "plugged_in", result: "yes" },
        { check: "mode", result: "auto" },
      ];
      await db.insertControllerLogEntries([{
        ...sampleEntry,
        inputsJson: JSON.stringify(inputs),
        checksJson: JSON.stringify(checks),
      }]);

      const { rows } = await db.logs.getControllerLogs({ limit: 1, offset: 0 });
      expect(JSON.parse(rows[0].inputsJson)).toEqual(inputs);
      expect(JSON.parse(rows[0].checksJson)).toEqual(checks);
    });

    it("pruneControllerLogs does not delete recent entries", async () => {
      await db.insertControllerLogEntries([sampleEntry]);
      await db.pruneControllerLogs(30);

      const { total } = await db.logs.getControllerLogs({
        limit: 1,
        offset: 0,
      });
      expect(total).toBe(1);
    });

    it("getLastControllerLogPerVehicle returns most recent entry per vehicle", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, vehicleId: "VIN_A", action: "start", targetAmps: 8 },
      ]);
      await db.insertControllerLogEntries([
        {
          ...sampleEntry,
          vehicleId: "VIN_B",
          action: "none",
          targetAmps: null,
        },
      ]);
      await db.insertControllerLogEntries([
        {
          ...sampleEntry,
          vehicleId: "VIN_A",
          action: "adjust_amps",
          targetAmps: 12,
        },
      ]);

      const results = await db.getLastControllerLogPerVehicle();
      expect(results).toHaveLength(2);

      const vinA = results.find((r) => r.vehicleId === "VIN_A");
      const vinB = results.find((r) => r.vehicleId === "VIN_B");
      expect(vinA?.action).toBe("adjust_amps");
      expect(vinA?.targetAmps).toBe(12);
      expect(vinB?.action).toBe("none");
    });

    it("getLastControllerLogPerVehicle returns empty array when no logs exist", async () => {
      const results = await db.getLastControllerLogPerVehicle();
      expect(results).toEqual([]);
    });

    it("filters by actions list", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, action: "start", actionDetail: "Starting" },
        { ...sampleEntry, action: "stop", actionDetail: "Stopping" },
        { ...sampleEntry, action: "none", actionDetail: "Idle" },
        {
          ...sampleEntry,
          action: "adjust_amps",
          actionDetail: "Adjusting",
        },
      ]);

      const { rows, total } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
        actions: ["start", "stop"],
      });
      expect(total).toBe(2);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => ["start", "stop"].includes(r.action))).toBe(
        true,
      );
    });

    it("filters by from date", async () => {
      await db.insertControllerLogEntries([sampleEntry]);

      const { total } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
        from: "2099-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
        from: "2000-01-01T00:00:00",
      });
      expect(total2).toBe(1);
    });

    it("filters by to date", async () => {
      await db.insertControllerLogEntries([sampleEntry]);

      const { total } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
        to: "2000-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
        to: "2099-01-01T00:00:00",
      });
      expect(total2).toBe(1);
    });

    it("getRecentStateChanges returns only start/stop actions", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, action: "start", actionDetail: "Starting" },
        { ...sampleEntry, action: "stop", actionDetail: "Stopping" },
        { ...sampleEntry, action: "none", actionDetail: "Idle" },
        { ...sampleEntry, action: "adjust_amps", actionDetail: "Adjusting" },
      ]);

      const rows = await db.getRecentStateChanges(60);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => ["start", "stop"].includes(r.action))).toBe(
        true,
      );
    });

    it("getRecentStateChanges respects the after parameter", async () => {
      await db.insertControllerLogEntries([
        { ...sampleEntry, action: "start", actionDetail: "first" },
        { ...sampleEntry, action: "stop", actionDetail: "second" },
      ]);

      // A far-past boundary should return all start/stop entries
      const all = await db.getRecentStateChanges(60, "2000-01-01T00:00:00");
      expect(all).toHaveLength(2);

      // A far-future boundary should return none
      const none = await db.getRecentStateChanges(60, "2099-01-01T00:00:00");
      expect(none).toHaveLength(0);
    });

    it("getRecentStateChanges returns empty array when no matching logs", async () => {
      const rows = await db.getRecentStateChanges(60);
      expect(rows).toEqual([]);
    });
  });
});
