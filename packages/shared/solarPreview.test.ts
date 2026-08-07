import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { ControllerConfig } from "./engine/mod.ts";
import type { ChargeSchedule, Schedule } from "./types.ts";
import type { PreviewVehicle } from "./solarPreview.ts";
import { previewSolarAllocation } from "./solarPreview.ts";

describe("previewSolarAllocation", () => {
  function makeConfig(
    overrides: Partial<ControllerConfig> = {},
  ): ControllerConfig {
    return {
      chargingEnabled: true,
      controllerLoopSeconds: 60,
      solarTrackingEnabled: true,
      solarTrackingMode: "solar_only",
      solarReference: "excess",
      solarMarginKw: 0,
      minSolarGenerationKw: 0.2,
      minExcessSolarKw: null,
      gridVoltage: 230,
      threePhaseCharger: false,
      consumptionExcludesCharging: false,
      gracePeriodMinutes: 6,
      cooldownPeriodMinutes: 15,
      ampDebounceThreshold: 2,
      ampDebounceSettleMinutes: 3,
      batteryPriorityEnabled: false,
      batteryPriorityLimit: 80,
      priorityChargingEnabled: false,
      timezone: "",
      ...overrides,
    };
  }

  function makeVehicle(
    overrides: Partial<PreviewVehicle> = {},
  ): PreviewVehicle {
    return {
      id: "VIN001",
      name: "Model 3",
      priority: 1,
      mode: "auto",
      batteryLevel: 50,
      chargeLimit: 100,
      chargeAmpsMin: 5,
      chargeAmpsMax: 16,
      chargerVoltage: 230,
      chargerPhases: 1,
      isCharging: false,
      chargeAmps: 0,
      ...overrides,
    };
  }

  const baseInputs = {
    batteryPowerKw: null,
    batterySoc: null,
    schedules: [] as Schedule[],
    simulatedTime: "12:00",
    simulatedDay: "mon" as const,
  };

  it("basic excess allocation — single vehicle charges from solar", () => {
    const result = previewSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      { ...baseInputs, solarProductionKw: 6, homeConsumptionKw: 1.5 },
    );
    // Excess = 6 - 1.5 = 4.5 kW -> 19.5A, clamped to max 16A
    expect(result.vehicles.length).toBe(1);
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(16);
    expect(result.vehicles[0].gridKw).toBe(0);
  });

  it("battery discharge is netted off — doesn't inflate available solar", () => {
    // Solar surplus (solar - home) is 2kW -> 8A either way. A battery
    // discharging on top of that raises grid export, but that export is not
    // solar — SolarAllocator.surplusW nets the discharge back off, so the
    // allocated amps must be identical regardless of how much the battery
    // discharges. (The old client code used raw export and would have let
    // the battery's own discharge inflate the "available solar" figure.)
    const noDischarge = previewSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        ...baseInputs,
        solarProductionKw: 6,
        homeConsumptionKw: 4,
        batteryPowerKw: 0,
      },
    );
    const withDischarge = previewSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        ...baseInputs,
        solarProductionKw: 6,
        homeConsumptionKw: 4,
        batteryPowerKw: 5,
      },
    );
    expect(noDischarge.vehicles[0].allocatedAmps).toBe(8);
    expect(withDischarge.vehicles[0].allocatedAmps).toBe(8);
  });

  it("battery charging (negative power) increases demand, reducing available solar further", () => {
    const charging = previewSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        ...baseInputs,
        solarProductionKw: 6,
        homeConsumptionKw: 1,
        batteryPowerKw: -3,
      },
    );
    const neutral = previewSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        ...baseInputs,
        solarProductionKw: 6,
        homeConsumptionKw: 1,
        batteryPowerKw: 0,
      },
    );
    expect(charging.vehicles[0].allocatedAmps).toBeLessThan(
      neutral.vehicles[0].allocatedAmps,
    );
  });

  it("a charging car's own draw is added back (consumptionExcludesCharging: false)", () => {
    // Home consumption slider already includes this car's own 10A draw, per
    // the default meter convention. The engine should add that back before
    // computing excess, so the car isn't penalized for its own consumption.
    const chargingCar = makeVehicle({ isCharging: true, chargeAmps: 10 });
    const result = previewSolarAllocation(
      makeConfig(),
      [chargingCar],
      { ...baseInputs, solarProductionKw: 4, homeConsumptionKw: 3.3 },
    );
    // Without add-back: excess = 4 - 3.3 = 0.7kW -> 3A (below min 5A -> skip).
    // With add-back: the car's own 10A*230V=2.3kW draw is added back:
    // excess = 0.7 + 2.3 = 3.0kW -> 13A.
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(13);
  });

  it("surplus is capped at panel output even with a large add-back", () => {
    const chargingCar = makeVehicle({
      isCharging: true,
      chargeAmps: 16,
      chargeAmpsMax: 32,
    });
    const result = previewSolarAllocation(
      makeConfig(),
      [chargingCar],
      { ...baseInputs, solarProductionKw: 5, homeConsumptionKw: 0.1 },
    );
    // Add-back (16A*230V=3.68kW) would push "excess" past production, but
    // surplus can never exceed the panels' output: 5kW -> 21A.
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(21);
  });

  it("waterfall allocation used when priorityChargingEnabled", () => {
    const result = previewSolarAllocation(
      makeConfig({ priorityChargingEnabled: true }),
      [
        makeVehicle({ id: "V1", priority: 1 }),
        makeVehicle({ id: "V2", priority: 2 }),
      ],
      { ...baseInputs, solarProductionKw: 4.5, homeConsumptionKw: 1.5 },
    );
    const v1 = result.vehicles.find((v) => v.id === "V1");
    const v2 = result.vehicles.find((v) => v.id === "V2");
    assertExists(v1);
    assertExists(v2);
    // Waterfall: V1 takes as much as it can (up to max 16A) before V2 gets any.
    expect(v1.allocatedAmps).toBe(13);
  });

  it("equal-split allocation used when priorityChargingEnabled is false", () => {
    const result = previewSolarAllocation(
      makeConfig({ priorityChargingEnabled: false }),
      [
        makeVehicle({
          id: "V1",
          priority: 1,
          chargeAmpsMin: 5,
          chargeAmpsMax: 16,
        }),
        makeVehicle({
          id: "V2",
          priority: 2,
          chargeAmpsMin: 5,
          chargeAmpsMax: 16,
        }),
      ],
      { ...baseInputs, solarProductionKw: 5.6, homeConsumptionKw: 1 },
    );
    const v1 = result.vehicles.find((v) => v.id === "V1");
    const v2 = result.vehicles.find((v) => v.id === "V2");
    assertExists(v1);
    assertExists(v2);
    // Equal split across both vehicles rather than one taking everything.
    expect(v1.action).toBe("charging");
    expect(v2.action).toBe("charging");
    expect(Math.abs(v1.allocatedAmps - v2.allocatedAmps)).toBeLessThanOrEqual(
      1,
    );
  });

  it("charge_now mode charges at max amps regardless of solar", () => {
    const result = previewSolarAllocation(
      makeConfig(),
      [makeVehicle({ mode: "charge_now" })],
      { ...baseInputs, solarProductionKw: 0, homeConsumptionKw: 1 },
    );
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(16);
    expect(result.vehicles[0].gridKw).toBeGreaterThan(0);
  });

  it("stop mode skips the vehicle", () => {
    const result = previewSolarAllocation(
      makeConfig(),
      [makeVehicle({ mode: "stop" })],
      { ...baseInputs, solarProductionKw: 6, homeConsumptionKw: 1 },
    );
    expect(result.vehicles[0].action).toBe("skipped");
  });

  it("blockout schedule skips auto vehicles and reports blockoutActive", () => {
    const blockout: Schedule = {
      id: "b1",
      vehicleId: null,
      chargerId: null,
      scheduleType: "blockout",
      startTime: "15:00",
      endTime: "21:00",
      days: ["mon"],
      enabled: true,
    };
    const result = previewSolarAllocation(
      makeConfig(),
      [makeVehicle()],
      {
        ...baseInputs,
        solarProductionKw: 6,
        homeConsumptionKw: 1,
        schedules: [blockout],
        simulatedTime: "16:00",
        simulatedDay: "mon",
      },
    );
    expect(result.blockoutActive).toBe(true);
    expect(result.vehicles[0].action).toBe("skipped");
  });

  it("charge schedule charges at scheduled amps with a schedule label", () => {
    const schedule: ChargeSchedule = {
      id: "s1",
      vehicleId: "VIN001",
      chargerId: null,
      scheduleType: "charge",
      startTime: "22:00",
      endTime: "06:00",
      days: ["mon"],
      chargeAmps: 10,
      chargeLimitPct: 80,
      enabled: true,
    };
    const result = previewSolarAllocation(
      makeConfig(),
      [makeVehicle({ batteryLevel: 50, chargeLimit: 100 })],
      {
        ...baseInputs,
        solarProductionKw: 2,
        homeConsumptionKw: 1,
        schedules: [schedule],
        simulatedTime: "23:00",
        simulatedDay: "mon",
      },
    );
    expect(result.vehicles[0].action).toBe("charging");
    expect(result.vehicles[0].allocatedAmps).toBe(10);
    expect(result.vehicles[0].scheduleName).toBe("Scheduled charging at 10A");
  });

  it("aggregate grid import/export accounts for EV charging and battery", () => {
    const result = previewSolarAllocation(
      makeConfig(),
      [makeVehicle({ mode: "charge_now" })],
      { ...baseInputs, solarProductionKw: 2, homeConsumptionKw: 1 },
    );
    // Charging at 16A * 230V = 3.68kW. Demand = 1 + 3.68 = 4.68kW.
    // Import = 4.68 - 2 = 2.68kW
    expect(result.gridImportKw).toBeCloseTo(2.68);
    expect(result.gridExportKw).toBe(0);
  });
});
