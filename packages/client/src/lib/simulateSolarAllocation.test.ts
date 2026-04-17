import { assertExists } from "@std/assert";
import { describe, expect, it } from "vitest";
import type { Schedule } from "@chargeha/shared";
import {
  findActiveSchedules,
  isTimeInRange,
  parseConfigToSolarConfig,
  simulateSolarAllocation,
} from "./simulateSolarAllocation.ts";
import {
  makeBlockoutSchedule,
  makeChargeSchedule,
  makeConfig,
  makeVehicle,
} from "./test-helpers/solarFactories.ts";

describe("parseConfigToSolarConfig", () => {
  it("parses a config record into SolarConfig", () => {
    const config = parseConfigToSolarConfig({
      solar_tracking_enabled: "true",
      solar_tracking_mode: "solar_grid",
      solar_reference: "gross",
      solar_margin_kw: "1.5",
      min_solar_generation_kw: "0.5",
      min_excess_solar_kw: "1.0",
      grid_voltage: "240",
      three_phase_charger: "true",
      battery_priority_enabled: "true",
      battery_priority_limit: "90",
    });
    expect(config).toEqual({
      solarTrackingEnabled: true,
      solarTrackingMode: "solar_grid",
      solarReference: "gross",
      solarMarginKw: 1.5,
      minSolarGenerationKw: 0.5,
      minExcessSolarKw: 1.0,
      gridVoltage: 240,
      threePhaseCharger: true,
      batteryPriorityEnabled: true,
      batteryPriorityLimit: 90,
    });
  });

  it("handles missing/empty values with defaults", () => {
    const config = parseConfigToSolarConfig({});
    expect(config.solarTrackingEnabled).toBe(false);
    expect(config.solarMarginKw).toBe(0);
    expect(config.minSolarGenerationKw).toBe(0.2);
    expect(config.minExcessSolarKw).toBeNull();
  });
});

describe("isTimeInRange", () => {
  it("returns true when time is within a normal range", () => {
    expect(isTimeInRange("10:00", "09:00", "17:00")).toBe(true);
  });

  it("returns false when time is outside a normal range", () => {
    expect(isTimeInRange("08:00", "09:00", "17:00")).toBe(false);
    expect(isTimeInRange("17:00", "09:00", "17:00")).toBe(false);
  });

  it("returns true for start boundary", () => {
    expect(isTimeInRange("09:00", "09:00", "17:00")).toBe(true);
  });

  it("handles overnight range — time after start", () => {
    expect(isTimeInRange("23:30", "23:00", "06:00")).toBe(true);
  });

  it("handles overnight range — time before end", () => {
    expect(isTimeInRange("01:00", "23:00", "06:00")).toBe(true);
  });

  it("handles overnight range — time outside", () => {
    expect(isTimeInRange("12:00", "23:00", "06:00")).toBe(false);
  });

  it("returns false for zero-length range", () => {
    expect(isTimeInRange("10:00", "10:00", "10:00")).toBe(false);
  });
});

describe("findActiveSchedules", () => {
  it("finds active blockout schedule", () => {
    const result = findActiveSchedules(
      [makeBlockoutSchedule()],
      "16:00",
      "mon",
    );
    expect(result.blockoutActive).toBe(true);
    expect(result.vehicleChargeSchedules.size).toBe(0);
  });

  it("finds active charge schedule", () => {
    const result = findActiveSchedules(
      [makeChargeSchedule()],
      "23:00",
      "mon",
    );
    expect(result.blockoutActive).toBe(false);
    expect(result.vehicleChargeSchedules.has("VIN001")).toBe(true);
  });

  it("ignores disabled schedules", () => {
    const result = findActiveSchedules(
      [makeBlockoutSchedule({ enabled: false })],
      "16:00",
      "mon",
    );
    expect(result.blockoutActive).toBe(false);
  });

  it("ignores schedules on wrong day", () => {
    const result = findActiveSchedules(
      [makeBlockoutSchedule({ days: ["sat", "sun"] })],
      "16:00",
      "mon",
    );
    expect(result.blockoutActive).toBe(false);
  });

  it("ignores schedules at wrong time", () => {
    const result = findActiveSchedules(
      [makeBlockoutSchedule()],
      "10:00",
      "mon",
    );
    expect(result.blockoutActive).toBe(false);
  });
});

describe("simulateSolarAllocation", () => {
  it("basic excess allocation — single vehicle charges from solar", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      { solarProductionKw: 6, homeConsumptionKw: 1.5, batterySoc: null },
    );
    // Excess = 6 - 1.5 = 4.5 kW. 4500W / 230V = 19.5A, clamped to max 16A
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(16);
    expect(result.vehicles[0].gridKw).toBe(0);
  });

  it("gross reference — uses total solar production", () => {
    const result = simulateSolarAllocation(
      makeConfig({ solarReference: "gross" }),
      [makeVehicle()],
      { solarProductionKw: 3, homeConsumptionKw: 2, batterySoc: null },
    );
    // Gross: available = 3 kW. 3000/230 = 13A
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(13);
  });

  it("solar margin reduces available solar", () => {
    const result = simulateSolarAllocation(
      makeConfig({ solarMarginKw: 1.0 }),
      [makeVehicle()],
      { solarProductionKw: 5, homeConsumptionKw: 1, batterySoc: null },
    );
    // Excess = 4 kW, minus margin 1 kW = 3 kW. 3000/230 = 13A
    expect(result.vehicles[0].allocatedAmps).toBe(13);
    expect(result.availableSolarKw).toBeCloseTo(3.0);
  });

  it("min solar generation threshold blocks charging", () => {
    const result = simulateSolarAllocation(
      makeConfig({ minSolarGenerationKw: 1.0 }),
      [makeVehicle()],
      { solarProductionKw: 0.5, homeConsumptionKw: 0.1, batterySoc: null },
    );
    expect(result.meetsMinSolarGeneration).toBe(false);
    expect(result.vehicles[0].action).toBe("skipped");
    expect(result.vehicles[0].reason).toContain("Solar generation below");
  });

  it("min excess solar threshold blocks charging", () => {
    const result = simulateSolarAllocation(
      makeConfig({ minExcessSolarKw: 2.0 }),
      [makeVehicle()],
      { solarProductionKw: 3, homeConsumptionKw: 2, batterySoc: null },
    );
    // Excess = 1 kW, below threshold of 2 kW
    expect(result.meetsMinExcessSolar).toBe(false);
    expect(result.vehicles[0].action).toBe("skipped");
    expect(result.vehicles[0].reason).toContain("Excess solar below");
  });

  it("battery priority blocks solar charging when SOC is low", () => {
    const result = simulateSolarAllocation(
      makeConfig({ batteryPriorityEnabled: true, batteryPriorityLimit: 80 }),
      [makeVehicle()],
      { solarProductionKw: 6, homeConsumptionKw: 1, batterySoc: 50 },
    );
    expect(result.batteryPriorityBlocking).toBe(true);
    expect(result.vehicles[0].action).toBe("skipped");
    expect(result.vehicles[0].reason).toContain("Battery");
    expect(result.availableSolarKw).toBe(0);
  });

  it("battery priority does not block when SOC is above limit", () => {
    const result = simulateSolarAllocation(
      makeConfig({ batteryPriorityEnabled: true, batteryPriorityLimit: 80 }),
      [makeVehicle()],
      { solarProductionKw: 6, homeConsumptionKw: 1, batterySoc: 85 },
    );
    expect(result.batteryPriorityBlocking).toBe(false);
    expect(result.vehicles[0].action).toBe("charging");
  });

  it("charge_now mode charges at max amps regardless of solar", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle({ mode: "charge_now" })],
      { solarProductionKw: 0, homeConsumptionKw: 1, batterySoc: null },
    );
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(16);
    expect(result.vehicles[0].gridKw).toBeGreaterThan(0);
    expect(result.vehicles[0].reason).toBe("Charge now at max amps");
  });

  it("stop mode skips vehicle", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle({ mode: "stop" })],
      { solarProductionKw: 6, homeConsumptionKw: 1, batterySoc: null },
    );
    expect(result.vehicles[0].action).toBe("skipped");
    expect(result.vehicles[0].reason).toBe("Mode set to stop");
  });

  it("battery at charge limit skips vehicle", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle({ batteryLevel: 80, chargeLimit: 80 })],
      { solarProductionKw: 6, homeConsumptionKw: 1, batterySoc: null },
    );
    expect(result.vehicles[0].action).toBe("skipped");
    expect(result.vehicles[0].reason).toBe("Battery at charge limit");
  });

  it("multi-vehicle priority — higher priority gets solar first", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [
        makeVehicle({ id: "V1", name: "Car 1", priority: 1 }),
        makeVehicle({ id: "V2", name: "Car 2", priority: 2 }),
      ],
      // Excess = 3 kW = enough for ~13A on one car, remainder for second
      { solarProductionKw: 4.5, homeConsumptionKw: 1.5, batterySoc: null },
    );
    const v1 = result.vehicles.find((v) => v.id === "V1");
    const v2 = result.vehicles.find((v) => v.id === "V2");
    assertExists(v1);
    assertExists(v2);
    expect(v1.action).toBe("charging");
    expect(v1.allocatedAmps).toBe(13); // 3000/230 = 13
    // Remaining: 3.0 - (13*230/1000) = 3.0 - 2.99 ≈ 0.01 kW — not enough for V2
    expect(v2.action).toBe("skipped");
  });

  it("solar_grid mode charges at min amps when solar insufficient", () => {
    const result = simulateSolarAllocation(
      makeConfig({ solarTrackingMode: "solar_grid" }),
      [makeVehicle()],
      // Excess = 0.5 kW = ~2A, below min of 5A
      { solarProductionKw: 1.5, homeConsumptionKw: 1, batterySoc: null },
    );
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(5); // min amps
    expect(result.vehicles[0].gridKw).toBeGreaterThan(0);
    expect(result.vehicles[0].reason).toBe("Solar + grid at minimum amps");
  });

  it("solar_only mode skips when solar insufficient for min amps", () => {
    const result = simulateSolarAllocation(
      makeConfig({ solarTrackingMode: "solar_only" }),
      [makeVehicle()],
      // Excess = 0.5 kW = ~2A, below min of 5A
      { solarProductionKw: 1.5, homeConsumptionKw: 1, batterySoc: null },
    );
    expect(result.vehicles[0].action).toBe("skipped");
    expect(result.vehicles[0].reason).toBe(
      "Insufficient solar for minimum amps",
    );
  });

  it("three-phase charger uses correct power calculation", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle({ chargerPhases: 3 })],
      // Excess = 5 kW. 5000 / (230*3) = 7.2A → 7A
      { solarProductionKw: 6, homeConsumptionKw: 1, batterySoc: null },
    );
    expect(result.vehicles[0].allocatedAmps).toBe(7);
    // 7 * 230 * 3 = 4830W = 4.83 kW
    expect(result.vehicles[0].allocatedKw).toBeCloseTo(4.83);
  });

  it("grid import calculation is correct", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle({ mode: "charge_now" })],
      { solarProductionKw: 2, homeConsumptionKw: 1, batterySoc: null },
    );
    // Charging at 16A * 230V = 3.68 kW. Total demand = 1 + 3.68 = 4.68 kW. Import = 4.68 - 2 = 2.68 kW
    expect(result.gridImportKw).toBeCloseTo(2.68);
    expect(result.gridExportKw).toBe(0);
  });

  it("grid export when solar exceeds consumption + charging", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle({ batteryLevel: 100, chargeLimit: 100 })], // Will be skipped
      { solarProductionKw: 8, homeConsumptionKw: 2, batterySoc: null },
    );
    // No charging, solar 8 - home 2 = 6 kW export
    expect(result.gridExportKw).toBeCloseTo(6);
    expect(result.gridImportKw).toBe(0);
  });

  it("charge_now deducts from remaining solar for subsequent vehicles", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [
        makeVehicle({
          id: "V1",
          name: "Car 1",
          priority: 1,
          mode: "charge_now",
        }),
        makeVehicle({ id: "V2", name: "Car 2", priority: 2, mode: "auto" }),
      ],
      { solarProductionKw: 6, homeConsumptionKw: 1, batterySoc: null },
    );
    const v1 = result.vehicles.find((v) => v.id === "V1");
    const v2 = result.vehicles.find((v) => v.id === "V2");
    assertExists(v1);
    assertExists(v2);
    // V1 charge_now at 16A = 3.68 kW, uses up most/all remaining solar
    expect(v1.action).toBe("charging");
    // V2 gets whatever solar is left after V1
    expect(v2.allocatedAmps).toBeLessThan(v1.allocatedAmps);
  });

  // ── Schedule-aware tests ──

  it("blockout active — auto vehicles skipped, charge_now unaffected", () => {
    const schedules: Schedule[] = [
      makeBlockoutSchedule({
        startTime: "15:00",
        endTime: "21:00",
        days: ["tue"],
      }),
    ];

    const result = simulateSolarAllocation(
      makeConfig(),
      [
        makeVehicle({ id: "V1", name: "Auto Car", priority: 1, mode: "auto" }),
        makeVehicle({
          id: "V2",
          name: "Charge Now Car",
          priority: 2,
          mode: "charge_now",
        }),
      ],
      {
        solarProductionKw: 6,
        homeConsumptionKw: 1,
        batterySoc: null,
        schedules,
        simulatedTime: "16:00",
        simulatedDay: "tue",
      },
    );

    expect(result.blockoutActive).toBe(true);
    const v1 = result.vehicles.find((v) => v.id === "V1");
    const v2 = result.vehicles.find((v) => v.id === "V2");
    assertExists(v1);
    assertExists(v2);
    expect(v1.action).toBe("skipped");
    expect(v1.reason).toBe("Blockout schedule active");
    expect(v2.action).toBe("charging");
    expect(v2.reason).toBe("Charge now at max amps");
  });

  it("charge schedule active — charges at schedule amps with schedule charge limit", () => {
    const schedules: Schedule[] = [
      makeChargeSchedule({
        vehicleId: "VIN001",
        startTime: "22:00",
        endTime: "06:00",
        chargeAmps: 10,
        chargeLimitPct: 80,
        days: ["mon"],
      }),
    ];

    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle({ batteryLevel: 50, chargeLimit: 100 })],
      {
        solarProductionKw: 2,
        homeConsumptionKw: 1,
        batterySoc: null,
        schedules,
        simulatedTime: "23:00",
        simulatedDay: "mon",
      },
    );

    const v = result.vehicles[0];
    expect(v.action).toBe("charging");
    expect(v.allocatedAmps).toBe(10);
    expect(v.reason).toBe("Scheduled charging at 10A");
    expect(v.scheduleName).toBe("Scheduled charging at 10A");
    // Solar-first: 2-1=1 kW excess available, 10A*230V=2.3kW needed
    expect(v.solarKw).toBeCloseTo(1.0);
    expect(v.gridKw).toBeCloseTo(1.3);
  });

  it("charge schedule + battery at schedule limit — skipped", () => {
    const schedules: Schedule[] = [
      makeChargeSchedule({
        vehicleId: "VIN001",
        chargeLimitPct: 80,
        days: ["mon"],
      }),
    ];

    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle({ batteryLevel: 80, chargeLimit: 100 })],
      {
        solarProductionKw: 6,
        homeConsumptionKw: 1,
        batterySoc: null,
        schedules,
        simulatedTime: "23:00",
        simulatedDay: "mon",
      },
    );

    const v = result.vehicles[0];
    expect(v.action).toBe("skipped");
    expect(v.reason).toBe("Battery at schedule charge limit");
    expect(v.scheduleName).toContain("Scheduled charging");
  });

  it("no schedule match (wrong time/day) — normal solar behavior", () => {
    const schedules: Schedule[] = [
      makeChargeSchedule({ days: ["sat"] }),
      makeBlockoutSchedule({ days: ["sat"] }),
    ];

    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        solarProductionKw: 6,
        homeConsumptionKw: 1,
        batterySoc: null,
        schedules,
        simulatedTime: "12:00",
        simulatedDay: "mon",
      },
    );

    expect(result.blockoutActive).toBe(false);
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].reason).toBe("Solar charging");
    expect(result.vehicles[0].scheduleName).toBeUndefined();
  });

  it("overnight schedule spanning midnight — correctly detected as active", () => {
    const schedules: Schedule[] = [
      makeChargeSchedule({
        vehicleId: "VIN001",
        startTime: "23:00",
        endTime: "06:00",
        chargeAmps: 8,
        chargeLimitPct: 90,
        days: ["wed"],
      }),
    ];

    // At 01:00 on Wednesday — should be in-range for the overnight schedule
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        solarProductionKw: 0,
        homeConsumptionKw: 0.5,
        batterySoc: null,
        schedules,
        simulatedTime: "01:00",
        simulatedDay: "wed",
      },
    );

    const v = result.vehicles[0];
    expect(v.action).toBe("charging");
    expect(v.allocatedAmps).toBe(8);
    expect(v.reason).toBe("Scheduled charging at 8A");

    // At 12:00 on Wednesday — should NOT be in range
    const result2 = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        solarProductionKw: 6,
        homeConsumptionKw: 1,
        batterySoc: null,
        schedules,
        simulatedTime: "12:00",
        simulatedDay: "wed",
      },
    );

    expect(result2.vehicles[0].action).toBe("charging");
    expect(result2.vehicles[0].reason).toBe("Solar charging");
  });

  it("charge schedule takes priority over blockout for same vehicle", () => {
    const schedules: Schedule[] = [
      makeBlockoutSchedule({
        startTime: "22:00",
        endTime: "06:00",
        days: ["mon"],
      }),
      makeChargeSchedule({
        vehicleId: "VIN001",
        startTime: "22:00",
        endTime: "06:00",
        chargeAmps: 10,
        chargeLimitPct: 80,
        days: ["mon"],
      }),
    ];

    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        solarProductionKw: 0,
        homeConsumptionKw: 0.5,
        batterySoc: null,
        schedules,
        simulatedTime: "23:00",
        simulatedDay: "mon",
      },
    );

    // Charge schedule should win because it's checked before blockout
    expect(result.blockoutActive).toBe(true);
    const v = result.vehicles[0];
    expect(v.action).toBe("charging");
    expect(v.reason).toBe("Scheduled charging at 10A");
  });

  it("blockoutActive defaults to false when no schedules provided", () => {
    const result = simulateSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      { solarProductionKw: 6, homeConsumptionKw: 1, batterySoc: null },
    );
    expect(result.blockoutActive).toBe(false);
  });
});
