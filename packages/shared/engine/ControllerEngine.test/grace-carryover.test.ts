import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";

describe("ControllerEngine — grace and cooldown across rule changes", () => {
  const T0 = 1_000_000;
  const HOUR = 3_600_000;
  const MINUTE = 60_000;
  const dip = { solarProductionW: 1100, gridPowerW: 3700 };
  const sunny = { gridPowerW: -5000 };
  const charging = { isCharging: true, chargeAmps: 16 };

  const startGrace = (engine: ControllerEngine) => {
    engine.decide(makeInput({
      vehicle: { state: charging },
      energyOverrides: dip,
      timestamp: T0,
    }));
    engine.getControlState("V1").graceNotified = true;
  };

  const expectFreshGrace = (engine: ControllerEngine, timestamp: number) => {
    const out = engine.decide(makeInput({
      vehicle: { state: charging },
      energyOverrides: dip,
      timestamp,
    }));
    const decision = out.decisions.get("V1");
    expect(decision?.action).toBe("adjust_amps");
    expect(decision?.reason).toBe("grace_period");
    const cs = engine.getControlState("V1");
    expect(cs.graceStartedAt).toBe(timestamp);
    expect(cs.graceNotified).toBe(false);
    expect(cs.cooldownUntil).toBeNull();
  };

  it("starts a fresh grace after another rule decided", () => {
    const engine = new ControllerEngine();
    startGrace(engine);
    engine.decide(makeInput({
      vehicle: { mode: "charge_now", state: charging },
      energyOverrides: dip,
      timestamp: T0 + HOUR,
    }));
    expectFreshGrace(engine, T0 + 2 * HOUR);
  });

  it("starts a fresh grace after charging was disabled", () => {
    const engine = new ControllerEngine();
    startGrace(engine);
    engine.decide(makeInput({
      vehicle: { state: charging },
      configOverrides: { chargingEnabled: false },
      timestamp: T0 + HOUR,
    }));
    expectFreshGrace(engine, T0 + 2 * HOUR);
  });

  it("starts a fresh grace after vehicle state was missing", () => {
    const engine = new ControllerEngine();
    startGrace(engine);
    engine.decide(makeInput({
      vehicle: { state: null },
      timestamp: T0 + HOUR,
    }));
    expectFreshGrace(engine, T0 + 2 * HOUR);
  });

  it("keeps start time and notified flag across grace loops", () => {
    const engine = new ControllerEngine();
    startGrace(engine);
    engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      energyOverrides: dip,
      timestamp: T0 + MINUTE,
    }));
    const cs = engine.getControlState("V1");
    expect(cs.graceStartedAt).toBe(T0);
    expect(cs.graceNotified).toBe(true);
  });

  it("tracks solar when a car is already charging during a cooldown", () => {
    const engine = new ControllerEngine();
    engine.getControlState("V1").cooldownUntil = T0 + HOUR;
    const out = engine.decide(makeInput({
      vehicle: { state: charging },
      energyOverrides: sunny,
      timestamp: T0,
    }));
    expect(out.decisions.get("V1")?.reason).toBe("solar_tracking");
  });

  it("keeps the cooldown when a stopped car still reads as charging", () => {
    const engine = new ControllerEngine();
    engine.getControlState("V1").cooldownUntil = T0 + HOUR;
    engine.decide(makeInput({
      vehicle: { state: charging },
      energyOverrides: sunny,
      timestamp: T0,
    }));
    const out = engine.decide(makeInput({
      vehicle: { state: { isCharging: false } },
      energyOverrides: sunny,
      timestamp: T0 + MINUTE,
    }));
    expect(out.decisions.get("V1")?.reason).toBe("cooldown");
  });
});
