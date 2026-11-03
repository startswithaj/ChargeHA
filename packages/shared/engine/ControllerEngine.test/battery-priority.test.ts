import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import {
  makeConfig,
  makeEnergy,
  makeInput,
  makeVehicle,
} from "../test-helpers/controller-engine.ts";

describe("ControllerEngine — battery priority", () => {
  const holdingConfig = {
    batteryPriorityEnabled: true,
    batteryPriorityLimit: 50,
  };

  it("waits while the home battery takes all the solar", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: holdingConfig,
      energyOverrides: {
        batterySoc: 30,
        gridPowerW: 0,
        batteryPowerW: -3000,
      },
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("none");
    expect(d?.detail).toBe("Waiting for home battery (30% < 50%)");
  });

  it("charges from export the home battery can't take", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: holdingConfig,
      energyOverrides: {
        solarProductionW: 15000,
        gridPowerW: -5000,
        batteryPowerW: -10000,
        batterySoc: 30,
      },
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("start");
    expect(d?.targetAmps).toBe(20);
  });

  it("only gives the car export in gross mode", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: { ...holdingConfig, solarReference: "gross" },
      energyOverrides: {
        solarProductionW: 15000,
        gridPowerW: -5000,
        batteryPowerW: -10000,
        batterySoc: 30,
      },
    }));
    expect(output.decisions.get("V1")?.targetAmps).toBe(20);
  });

  it("lowers the car on a small dip instead of dropping to min", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: { ...holdingConfig, ampDebounceThreshold: 0 },
      vehicle: { state: { isCharging: true, chargeAmps: 20 } },
      energyOverrides: { batterySoc: 30, gridPowerW: -100 },
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("adjust_amps");
    expect(d?.targetAmps).toBe(19);
  });

  it("drops to min amps when export stops while charging", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: true, chargeAmps: 10 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("adjust_amps");
    expect(d?.targetAmps).toBe(5);
  });

  it("stops when export stays gone past the grace period", () => {
    const engine = new ControllerEngine();
    const baseTimestamp = Date.now();
    engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: true, chargeAmps: 10 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
      timestamp: baseTimestamp,
    }));
    const output = engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
      timestamp: baseTimestamp + 7 * 60 * 1000,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("stop");
    expect(d?.detail).toContain("battery priority");
  });

  it("starts a cooldown when it stops the car", () => {
    const engine = new ControllerEngine();
    const baseTimestamp = Date.now();
    engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: true, chargeAmps: 10 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
      timestamp: baseTimestamp,
    }));
    engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
      timestamp: baseTimestamp + 7 * 60 * 1000,
    }));
    const output = engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: false } },
      energyOverrides: { batterySoc: 30, gridPowerW: -5000 },
      timestamp: baseTimestamp + 8 * 60 * 1000,
    }));
    expect(output.decisions.get("V1")?.detail).toContain("Cooldown");
  });

  it("restarts the grace period once export comes back", () => {
    const engine = new ControllerEngine();
    const baseTimestamp = Date.now();
    engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: true, chargeAmps: 10 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
      timestamp: baseTimestamp,
    }));
    engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      energyOverrides: { batterySoc: 30, gridPowerW: -5000 },
      timestamp: baseTimestamp + 3 * 60 * 1000,
    }));
    const output = engine.decide(makeInput({
      configOverrides: holdingConfig,
      vehicle: { state: { isCharging: true, chargeAmps: 20 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
      timestamp: baseTimestamp + 7 * 60 * 1000,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("adjust_amps");
    expect(d?.targetAmps).toBe(5);
  });

  it("holds a car the allocator gave nothing in solar_grid mode", () => {
    const engine = new ControllerEngine();
    const output = engine.decide({
      config: makeConfig({
        ...holdingConfig,
        solarTrackingMode: "solar_grid",
        priorityChargingEnabled: true,
      }),
      vehicles: [
        makeVehicle({
          id: "V1",
          name: "EV 1",
          priority: 1,
          state: { isCharging: true, chargeAmps: 10 },
        }),
        makeVehicle({ id: "V2", name: "EV 2", priority: 2 }),
      ],
      activeBlockout: null,
      energy: makeEnergy({ gridPowerW: -2000, batterySoc: 30 }),
      now: new Date("2026-01-01T12:00:00Z"),
      timestamp: Date.now(),
    });
    expect(output.decisions.get("V2")?.detail).toBe(
      "Waiting for home battery (30% < 50%)",
    );
  });

  it("stops instead of falling back to grid in solar_grid mode", () => {
    const engine = new ControllerEngine();
    const baseTimestamp = Date.now();
    const configOverrides = {
      ...holdingConfig,
      solarTrackingMode: "solar_grid" as const,
    };
    engine.decide(makeInput({
      configOverrides,
      vehicle: { state: { isCharging: true, chargeAmps: 10 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
      timestamp: baseTimestamp,
    }));
    const output = engine.decide(makeInput({
      configOverrides,
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      energyOverrides: { batterySoc: 30, gridPowerW: 0 },
      timestamp: baseTimestamp + 7 * 60 * 1000,
    }));
    expect(output.decisions.get("V1")?.action).toBe("stop");
  });

  it("proceeds when home battery is above priority limit", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: {
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 50,
      },
      energyOverrides: { batterySoc: 60, gridPowerW: -5000 },
    }));
    expect(output.decisions.get("V1")?.action).toBe("start");
  });

  it("reports an averaged SOC to one decimal", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: {
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 100,
      },
      energyOverrides: { batterySoc: 96.23333333333335, gridPowerW: 0 },
    }));
    expect(output.decisions.get("V1")?.detail).toBe(
      "Waiting for home battery (96.2% < 100%)",
    );
  });

  it("holds a battery that displays as the limit but has not reached it", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: {
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 100,
      },
      energyOverrides: { batterySoc: 99.96, gridPowerW: 0 },
    }));
    expect(output.decisions.get("V1")?.action).toBe("none");
    expect(output.decisions.get("V1")?.detail).toBe(
      "Waiting for home battery (99.9% < 100%)",
    );
  });

  it("says excess solar in gross mode, since only export is used", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: { ...holdingConfig, solarReference: "gross" },
      vehicle: { state: { isCharging: true, chargeAmps: 10 } },
      energyOverrides: {
        batterySoc: 30,
        gridPowerW: 0,
        solarProductionW: 6000,
      },
    }));
    expect(output.decisions.get("V1")?.detail).toContain(
      "insufficient excess solar (0W → 0A < min 5A)",
    );
  });
});
