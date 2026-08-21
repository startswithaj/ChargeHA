import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";

/** Grace and cooldown are solar-tracking timers. Any loop that resolves before
 *  solar tracking runs — a schedule, a blockout, battery priority, a manual
 *  mode, an unplug — breaks the run of evaluations those timers measure, so
 *  they must not survive it. A leaked timer reads as long expired the next time
 *  solar tracking sees a dip, turning a 6-minute ride-out into an outright stop
 *  plus a 15-minute lockout. */
describe("ControllerEngine — solar timers do not leak across branches", () => {
  /** Marginal solar: above minSolarGenerationKw (1 kW), but the surplus can't
   *  sustain the vehicle's 5A minimum. */
  const DIP = { solarProductionW: 1100, gridPowerW: 2000 };
  /** Exporting 3 kW, so an idle vehicle has room to start at 13A. */
  const EXPORT = { solarProductionW: 5000, gridPowerW: -3000 };

  const T0 = 1_700_000_000_000;
  const MINUTE = 60 * 1000;

  /** Run one loop that arms a grace period, and assert it did. */
  const armGrace = (engine: ControllerEngine, timestamp: number) => {
    const output = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 32 } },
      energyOverrides: DIP,
      timestamp,
    }));
    expect(output.decisions.get("V1")?.reason).toBe("grace_period");
  };

  /** A dip after the interruption must get its own full grace period. */
  const expectFreshGrace = (engine: ControllerEngine, timestamp: number) => {
    const output = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 32 } },
      energyOverrides: DIP,
      timestamp,
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("adjust_amps");
    expect(d?.reason).toBe("grace_period");
    expect(d?.detail).toContain("0s/360s");
  };

  it("clears the grace period when a blockout takes over", () => {
    const engine = new ControllerEngine();
    armGrace(engine, T0);

    const blocked = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      configOverrides: { timezone: "UTC" },
      now: new Date("2026-01-01T03:00:00Z"),
      schedules: [{
        id: "b1",
        vehicleId: null,
        scheduleType: "blockout",
        enabled: true,
        startTime: "02:00",
        endTime: "06:00",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        chargeAmps: null,
        chargeLimitPct: null,
      }],
      energyOverrides: DIP,
      timestamp: T0 + MINUTE,
    }));
    expect(blocked.decisions.get("V1")?.reason).toBe("blockout");

    expectFreshGrace(engine, T0 + 60 * MINUTE);
  });

  it("clears the grace period when battery priority takes over", () => {
    const engine = new ControllerEngine();
    armGrace(engine, T0);

    const held = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      configOverrides: {
        batteryPriorityEnabled: true,
        batteryPriorityLimit: 80,
      },
      energyOverrides: { ...DIP, batterySoc: 50 },
      timestamp: T0 + MINUTE,
    }));
    expect(held.decisions.get("V1")?.reason).toBe("battery_priority");

    expectFreshGrace(engine, T0 + 60 * MINUTE);
  });

  it("clears the grace period when the vehicle is unplugged", () => {
    const engine = new ControllerEngine();
    armGrace(engine, T0);

    engine.decide(makeInput({
      vehicle: { state: { isPluggedIn: false } },
      energyOverrides: DIP,
      timestamp: T0 + MINUTE,
    }));

    expectFreshGrace(engine, T0 + 60 * MINUTE);
  });

  it("clears the grace period when solar tracking is switched off", () => {
    const engine = new ControllerEngine();
    armGrace(engine, T0);

    engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      configOverrides: { solarTrackingEnabled: false },
      energyOverrides: DIP,
      timestamp: T0 + MINUTE,
    }));

    expectFreshGrace(engine, T0 + 60 * MINUTE);
  });

  it("lets a stop → auto toggle clear a cooldown that is blocking a restart", () => {
    const engine = new ControllerEngine();
    armGrace(engine, T0);

    // Grace expires: stop, and a 15-minute cooldown is armed.
    const expired = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      energyOverrides: DIP,
      timestamp: T0 + 7 * MINUTE,
    }));
    expect(expired.decisions.get("V1")?.action).toBe("stop");

    // Sun is back, but the cooldown holds the restart off.
    const blocked = engine.decide(makeInput({
      vehicle: { state: { isCharging: false } },
      energyOverrides: EXPORT,
      timestamp: T0 + 8 * MINUTE,
    }));
    expect(blocked.decisions.get("V1")?.reason).toBe("cooldown");

    // The user flips the vehicle to stop and back to auto. Switching out of
    // auto ends the run of solar evaluations, so the cooldown goes with it.
    engine.decide(makeInput({
      vehicle: { mode: "stop", state: { isCharging: false } },
      energyOverrides: EXPORT,
      timestamp: T0 + 9 * MINUTE,
    }));

    const resumed = engine.decide(makeInput({
      vehicle: { state: { isCharging: false } },
      energyOverrides: EXPORT,
      timestamp: T0 + 10 * MINUTE,
    }));
    const d = resumed.decisions.get("V1");
    expect(d?.action).toBe("start");
    expect(d?.reason).toBe("solar_tracking");
    expect(d?.targetAmps).toBe(13);
  });
});
