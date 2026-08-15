import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";

describe("ControllerEngine — free tariff charging", () => {
  /** Night-time energy: no solar, importing from the grid. Solar tracking
   *  terminates on its own here, so anything that still charges is proof the
   *  free-tariff step ran before it. */
  const NIGHT = { solarProductionW: 0, gridPowerW: 2000 };
  const FREE = { freeTariffChargingEnabled: true, freeTariffMaxRatePerKwh: 0 };

  it("starts at max amps when the grid is free and there is no sun", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: FREE,
      energyOverrides: NIGHT,
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("start");
    expect(d?.reason).toBe("free_tariff");
    expect(d?.targetAmps).toBe(32);
    expect(d?.detail).toContain("grid is free");
  });

  it("treats a negative rate as free", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: FREE,
      energyOverrides: NIGHT,
      currentRatePerKwh: -0.05,
    }));
    expect(output.decisions.get("V1")?.reason).toBe("free_tariff");
  });

  it("charges through a cheap window when a threshold is configured", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: {
        freeTariffChargingEnabled: true,
        freeTariffMaxRatePerKwh: 0.10,
      },
      energyOverrides: NIGHT,
      currentRatePerKwh: 0.08,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("start");
    expect(d?.detail).toContain("grid rate is 0.08/kWh");
  });

  it("adjusts up to max amps when already charging lower", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 8 } },
      configOverrides: FREE,
      energyOverrides: NIGHT,
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("adjust_amps");
    expect(d?.targetAmps).toBe(32);
  });

  it("holds steady when already charging at max amps", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 32 } },
      configOverrides: FREE,
      energyOverrides: NIGHT,
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("none");
    expect(d?.reason).toBe("free_tariff");
  });

  it("charges with no energy snapshot when battery priority is off", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: FREE,
      energy: null,
      currentRatePerKwh: 0,
    }));
    expect(output.decisions.get("V1")?.reason).toBe("free_tariff");
  });
});

describe("ControllerEngine — free tariff does not apply", () => {
  /** Night-time energy: no solar, importing from the grid. Solar tracking
   *  terminates on its own here, so anything that still charges is proof the
   *  free-tariff step ran before it. */
  const NIGHT = { solarProductionW: 0, gridPowerW: 2000 };
  const FREE = { freeTariffChargingEnabled: true, freeTariffMaxRatePerKwh: 0 };

  it("falls through to solar tracking when disabled", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      energyOverrides: NIGHT,
      currentRatePerKwh: 0,
    }));
    expect(output.decisions.get("V1")?.reason).toBe("no_solar");
  });

  it("never charges on an unresolved rate", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: FREE,
      energyOverrides: NIGHT,
      currentRatePerKwh: null,
    }));
    const d = output.decisions.get("V1");
    expect(d?.reason).toBe("no_solar");
    expect(d?.checks).toContainEqual({
      check: "free_tariff",
      result: "skip (rate unknown)",
    });
  });

  it("falls through when the rate is above the free threshold", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: FREE,
      energyOverrides: NIGHT,
      currentRatePerKwh: 0.30,
    }));
    const d = output.decisions.get("V1");
    expect(d?.reason).toBe("no_solar");
    expect(d?.checks).toContainEqual({
      check: "free_tariff",
      result: "not free (0.3 > 0/kWh)",
    });
  });

  it("stops a running free charge once the rate stops being free", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 32 } },
      configOverrides: FREE,
      energyOverrides: NIGHT,
      currentRatePerKwh: 0.30,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("stop");
    expect(d?.reason).toBe("no_solar");
  });

  it("stops at the vehicle's charge limit even while the grid is free", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      vehicle: {
        state: { isCharging: true, batteryLevel: 80, chargeLimit: 80 },
      },
      configOverrides: FREE,
      energyOverrides: NIGHT,
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("stop");
    expect(d?.reason).toBe("battery_at_limit");
  });
});

describe("ControllerEngine — free tariff respects home battery priority", () => {
  /** Night-time energy: no solar, importing from the grid. Solar tracking
   *  terminates on its own here, so anything that still charges is proof the
   *  free-tariff step ran before it. */
  const NIGHT = { solarProductionW: 0, gridPowerW: 2000 };
  const FREE = { freeTariffChargingEnabled: true, freeTariffMaxRatePerKwh: 0 };

  const WITH_PRIORITY = {
    ...FREE,
    batteryPriorityEnabled: true,
    batteryPriorityLimit: 80,
  };

  it("holds while the home battery is below its priority limit", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: WITH_PRIORITY,
      energyOverrides: { ...NIGHT, batterySoc: 50 },
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("none");
    expect(d?.reason).toBe("battery_priority");
  });

  it("stops a running free charge when the home battery drops below", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 32 } },
      configOverrides: WITH_PRIORITY,
      energyOverrides: { ...NIGHT, batterySoc: 50 },
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("stop");
    expect(d?.reason).toBe("battery_priority");
  });

  it("charges once the home battery has reached its priority limit", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: WITH_PRIORITY,
      energyOverrides: { ...NIGHT, batterySoc: 85 },
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("start");
    expect(d?.reason).toBe("free_tariff");
  });

  it("holds when the inverter reports no home battery SoC", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: WITH_PRIORITY,
      energyOverrides: { ...NIGHT, batterySoc: null },
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("none");
    expect(d?.reason).toBe("free_tariff");
    expect(d?.detail).toContain("home battery SoC is unknown");
  });

  it("holds when there is no energy snapshot at all", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      configOverrides: WITH_PRIORITY,
      energy: null,
      currentRatePerKwh: 0,
    }));
    const d = output.decisions.get("V1");
    expect(d?.reason).toBe("free_tariff");
    expect(d?.detail).toContain("home battery SoC is unknown");
  });
});
