import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "./ControllerEngine.ts";
import type { EngineSchedule } from "./types.ts";
import type { DayOfWeek } from "../types.ts";
import {
  makeConfig,
  makeEnergy,
  makeInput,
  makeVehicle,
} from "./test-helpers/controller-engine.ts";

describe("ControllerEngine", () => {
  describe("preconditions", () => {
    it("returns none when vehicle has no state", () => {
      const engine = new ControllerEngine();
      const input = makeInput();
      input.vehicles = [{
        id: "V1",
        name: "EV 1",
        mode: "auto",
        priority: 1,
        state: null,
      }];
      const output = engine.decide(input);
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
      expect(d?.detail).toBe("No vehicle state available");
    });

    it("returns none when vehicle is not plugged in", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(
        makeInput({ vehicle: { state: { isPluggedIn: false } } }),
      );
      expect(output.decisions.get("V1")?.action).toBe("none");
    });

    it("returns none when vehicle is away from home", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(
        makeInput({ vehicle: { state: { isHome: false } } }),
      );
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
      expect(d?.detail).toContain("Away from home");
    });

    it("stops when battery is at charge limit", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(
        makeInput({
          vehicle: {
            state: { batteryLevel: 80, chargeLimit: 80, isCharging: true },
          },
        }),
      );
      expect(output.decisions.get("V1")?.action).toBe("stop");
    });

    it("returns none when battery at limit and already stopped", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(
        makeInput({
          vehicle: {
            state: { batteryLevel: 80, chargeLimit: 80, isCharging: false },
          },
        }),
      );
      expect(output.decisions.get("V1")?.action).toBe("none");
    });
  });

  describe("mode dispatch", () => {
    it("stops when mode is stop and vehicle is charging", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(
        makeInput({ vehicle: { mode: "stop", state: { isCharging: true } } }),
      );
      expect(output.decisions.get("V1")?.action).toBe("stop");
    });

    it("starts at max amps in charge_now mode", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(
        makeInput({ vehicle: { mode: "charge_now" } }),
      );
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBe(32);
    });
  });

  describe("solar tracking", () => {
    it("starts charging when excess solar exceeds minimum amps", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(
        makeInput({
          energyOverrides: { solarProductionW: 5000, gridPowerW: -3000 },
        }),
      );
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBeGreaterThanOrEqual(5);
    });

    it("does not start when solar is below minimum generation", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(
        makeInput({
          energyOverrides: { solarProductionW: 500, gridPowerW: 1000 },
        }),
      );
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
    });

    it("starts grace period when solar drops below minimum amps while charging", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // Tick 1: start charging with good solar
      engine.decide(makeInput({
        vehicle: { state: { isCharging: false } },
        energyOverrides: { gridPowerW: -5000 },
        timestamp: baseTimestamp,
      }));

      // Tick 2: solar drops significantly, vehicle is now charging at 5A (min)
      // gridPowerW = 2000 means importing 2kW. With add-back: -2000 + (5*230) = -850W → 0.
      // targetAmps = 0 < chargeAmpsMin → insufficient solar → grace period
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 1500, gridPowerW: 2000 },
        timestamp: baseTimestamp + 60_000,
      }));
      const d = output.decisions.get("V1");
      // Already at min amps — grace period active, no adjustment needed
      expect(d?.action).toBe("none");
      expect(d?.detail).toContain("Grace period");
    });

    it("stops after grace period expires (solar_only mode)", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // Tick 1: start with good solar
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -5000 },
        timestamp: baseTimestamp,
      }));

      // Tick 2: solar drops — enters grace period
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 500 },
        timestamp: baseTimestamp + 1000,
      }));

      // Tick 3: well past grace period (7 minutes later)
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 500 },
        timestamp: baseTimestamp + 7 * 60 * 1000,
      }));

      expect(output.decisions.get("V1")?.action).toBe("stop");
    });

    it("respects cooldown after stopping", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // Tick 1: charging with solar
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -5000 },
        timestamp: baseTimestamp,
      }));

      // Tick 2: solar drops — enters grace
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 500 },
        timestamp: baseTimestamp + 1000,
      }));

      // Tick 3: grace expires — stops, enters cooldown
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 500 },
        timestamp: baseTimestamp + 7 * 60 * 1000,
      }));

      // Tick 4: solar returns but cooldown is active — should NOT start
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: false } },
        energyOverrides: { gridPowerW: -5000 },
        timestamp: baseTimestamp + 8 * 60 * 1000,
      }));

      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
      expect(d?.detail).toContain("Cooldown");
    });

    it("charges at min amps in solar_grid mode when solar is insufficient", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 500 },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBe(5);
      expect(d?.detail).toContain("solar+grid");
    });

    it("uses reported single-phase over threePhaseCharger flag while charging", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: {
          threePhaseCharger: true,
          consumptionExcludesCharging: true,
        },
        vehicle: {
          state: {
            isCharging: true,
            chargeAmps: 5,
            chargeAmpsMax: 10,
            chargerPhases: 1,
          },
        },
        energyOverrides: { solarProductionW: 3000, gridPowerW: -2300 },
      }));
      const d = output.decisions.get("V1");
      expect(d?.targetAmps).toBe(10);
    });
  });

  describe("amp debouncing", () => {
    it("jumps directly to target when starting from not charging", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        energyOverrides: { gridPowerW: -5000 },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBeGreaterThan(5);
    });

    it("applies large changes immediately", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // Tick 1: start charging at 10A
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -5000 },
        timestamp: baseTimestamp,
      }));

      // Tick 2: large solar increase — target jumps well above threshold
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -8000 },
        timestamp: baseTimestamp + 10_000,
      }));

      const d = output.decisions.get("V1");
      // Large change (>2A), should apply immediately
      expect(d?.action).toBe("adjust_amps");
      expect(d?.targetAmps).toBeGreaterThan(12);
    });

    it("holds small changes until settled", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // At 10A charging (2300W), gridPowerW=-300 → available=2600W → target=11A
      // 1A diff is within debounce threshold
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -300 },
        timestamp: baseTimestamp,
      }));

      // Tick 2: same target, only 60s later — should still hold
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -300 },
        timestamp: baseTimestamp + 60_000,
      }));

      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
    });

    it("applies small changes after settle time elapses", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // At 10A charging (2300W), gridPowerW=-300 → available=2600W → target=11A
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -300 },
        timestamp: baseTimestamp,
      }));

      // Tick 2: same target, 4 minutes later — past 3min settle time
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -300 },
        timestamp: baseTimestamp + 4 * 60_000,
      }));

      const d = output.decisions.get("V1");
      expect(d?.action).toBe("adjust_amps");
    });

    it("honours ampDebounceThreshold from config", () => {
      // With threshold=4, a 3A change should be debounced (would apply
      // immediately at the default threshold=2).
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // At 10A charging (2300W), gridPowerW=-700 → available=3000W → target=13A
      // 3A difference is within threshold=4, so should be held.
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -700 },
        configOverrides: { ampDebounceThreshold: 4 },
        timestamp: baseTimestamp,
      }));

      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -700 },
        configOverrides: { ampDebounceThreshold: 4 },
        timestamp: baseTimestamp + 60_000,
      }));

      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
    });

    it("honours ampDebounceSettleMinutes from config", () => {
      // With settle=10 minutes, a 1A change at 4 minutes should still be held
      // (would apply at the default settle=3).
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -300 },
        configOverrides: { ampDebounceSettleMinutes: 10 },
        timestamp: baseTimestamp,
      }));

      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -300 },
        configOverrides: { ampDebounceSettleMinutes: 10 },
        timestamp: baseTimestamp + 4 * 60_000,
      }));

      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
    });
  });

  describe("schedules", () => {
    it("charges at schedule amps when charge schedule is active", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({ configOverrides: { timezone: "UTC" } }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 16,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBe(16);
    });

    it("stops when blockout schedule is active", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({
          vehicle: { state: { isCharging: true, chargeAmps: 10 } },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          scheduleType: "blockout",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: null,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("stop");
    });

    it("falls through to solar when schedule charge limit is reached", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({
          vehicle: { state: { batteryLevel: 85 } },
          energyOverrides: { gridPowerW: -5000 },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 16,
          chargeLimitPct: 80,
          enabled: true,
        }],
      });
      const d = output.decisions.get("V1");
      // Schedule limit reached at 85% >= 80%, falls through to solar tracking
      expect(d?.action).toBe("start");
      expect(d?.scheduleLimitContext?.scheduleLimitPct).toBe(80);
    });
  });

  describe("battery priority", () => {
    it("stops when home battery is below priority limit", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: {
          batteryPriorityEnabled: true,
          batteryPriorityLimit: 50,
        },
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { batterySoc: 30 },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("stop");
      expect(d?.detail).toContain("battery priority");
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
      // Should proceed to solar tracking and start
      expect(output.decisions.get("V1")?.action).toBe("start");
    });
  });

  describe("allocation", () => {
    it("allocates amps equally across two vehicles", () => {
      const engine = new ControllerEngine();
      const v1 = makeVehicle({ id: "V1", name: "EV 1", priority: 1 });
      const v2 = makeVehicle({ id: "V2", name: "EV 2", priority: 2 });
      const output = engine.decide({
        config: makeConfig(),
        vehicles: [v1, v2],
        schedules: [],
        energy: makeEnergy({ gridPowerW: -5000 }),
        now: new Date("2026-01-01T12:00:00Z"),
        timestamp: Date.now(),
      });
      const d1 = output.decisions.get("V1");
      const d2 = output.decisions.get("V2");
      expect(d1?.action).toBe("start");
      expect(d2?.action).toBe("start");
      // Both should get allocated amps (equal split)
      const total = (d1?.targetAmps ?? 0) + (d2?.targetAmps ?? 0);
      expect(total).toBeGreaterThan(0);
    });

    it("allocates via waterfall when priority charging is enabled", () => {
      const engine = new ControllerEngine();
      // Limited solar: only enough for ~8A total
      const v1 = makeVehicle({ id: "V1", name: "EV 1", priority: 1 });
      const v2 = makeVehicle({ id: "V2", name: "EV 2", priority: 2 });
      const output = engine.decide({
        config: makeConfig({ priorityChargingEnabled: true }),
        vehicles: [v1, v2],
        schedules: [],
        energy: makeEnergy({ gridPowerW: -2000 }),
        now: new Date("2026-01-01T12:00:00Z"),
        timestamp: Date.now(),
      });
      const d1 = output.decisions.get("V1");
      const d2 = output.decisions.get("V2");
      // Priority 1 should get all the amps, priority 2 gets none
      expect(d1?.targetAmps).toBeGreaterThanOrEqual(5);
      expect(d2?.targetAmps).toBe(null);
    });
  });

  describe("default fallback", () => {
    it("stops when no solar tracking and no schedule", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: { solarTrackingEnabled: false },
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energy: null,
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("stop");
      expect(d?.detail).toContain("no schedule or solar tracking");
    });

    it("marks as suspendable when idle with no schedule or solar", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: { solarTrackingEnabled: false },
        energy: null,
      }));
      expect(output.decisions.get("V1")?.suspendable).toBe(true);
    });
  });

  describe("preconditions — near limit", () => {
    it("does not retry when vehicle stopped within 1% of 100% target", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        vehicle: {
          state: {
            batteryLevel: 99,
            chargeLimit: 100,
            isCharging: false,
          },
        },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
      expect(d?.detail).toContain("within 1%");
    });
  });

  describe("charge_now — branches", () => {
    it("adjusts amps when charging at wrong rate", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        vehicle: {
          mode: "charge_now",
          state: { isCharging: true, chargeAmps: 10, chargeAmpsMax: 32 },
        },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("adjust_amps");
      expect(d?.targetAmps).toBe(32);
    });

    it("returns none when already charging at max", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        vehicle: {
          mode: "charge_now",
          state: { isCharging: true, chargeAmps: 32, chargeAmpsMax: 32 },
        },
      }));
      expect(output.decisions.get("V1")?.action).toBe("none");
    });
  });

  describe("min excess solar", () => {
    it("prevents starting when excess solar is below minimum", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: { minExcessSolarKw: 2 },
        energyOverrides: { solarProductionW: 3000, gridPowerW: -500 },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("none");
      expect(d?.detail).toContain("excess solar below minimum");
    });

    it("lets solar tracking handle fluctuations when already charging", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: { minExcessSolarKw: 5 },
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { solarProductionW: 3000, gridPowerW: -500 },
      }));
      expect(output.decisions.get("V1")?.action).not.toBe("stop");
    });
  });

  describe("min solar generation — edge cases", () => {
    it("stops immediately with zero solar while charging (no grace)", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { solarProductionW: 0, gridPowerW: 2000 },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("stop");
      expect(d?.detail).toContain("no solar generation");
    });

    it("falls through to tracking when some solar exists and charging", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 500, gridPowerW: 1000 },
      }));
      expect(output.decisions.get("V1")?.detail).not.toContain(
        "below minimum solar generation",
      );
    });
  });

  describe("grace period — adjust to min amps", () => {
    it("adjusts to min amps during grace when charging above minimum", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // Tick 1: charging
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 15 } },
        energyOverrides: { gridPowerW: -5000 },
        timestamp: baseTimestamp,
      }));

      // Tick 2: solar drops. Add-back: -3000 + 15*230 = 450W → 1A < 5A min
      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 15 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 3000 },
        timestamp: baseTimestamp + 60_000,
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("adjust_amps");
      expect(d?.targetAmps).toBe(5);
    });
  });

  describe("solar+grid fallback", () => {
    it("charges at min amps from grid when not charging and solar insufficient", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 500 },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBe(5);
      expect(d?.detail).toContain("solar+grid");
    });

    it("returns none when not charging and already in solar_grid fallback", () => {
      const engine = new ControllerEngine();
      // Not charging + insufficient solar in solar_grid → fallback to start at min
      const output = engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        vehicle: { state: { isCharging: false } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 500 },
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("start");
      expect(d?.targetAmps).toBe(5);
      expect(d?.detail).toContain("solar+grid");
    });

    it("falls back to grid when grace expires in solar_grid mode", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -5000 },
        timestamp: baseTimestamp,
      }));

      engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 3000 },
        timestamp: baseTimestamp + 1000,
      }));

      const output = engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 3000 },
        timestamp: baseTimestamp + 7 * 60 * 1000,
      }));
      expect(output.decisions.get("V1")?.detail).toContain("solar+grid");
    });
  });

  describe("blockout — notification tracking", () => {
    it("resets notification flag when vehicle stops during blockout", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const allDays: DayOfWeek[] = [
        "mon",
        "tue",
        "wed",
        "thu",
        "fri",
        "sat",
        "sun",
      ];
      const blockout: EngineSchedule = {
        id: "s1",
        vehicleId: null,
        scheduleType: "blockout",
        startTime: "02:00",
        endTime: "06:00",
        days: allDays,
        chargeAmps: null,
        chargeLimitPct: null,
        enabled: true,
      };

      engine.decide({
        ...makeInput({
          vehicle: { state: { isCharging: true } },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [blockout],
      });
      expect(engine.getControlState("V1").blockoutChargeNotified).toBe(true);

      engine.decide({
        ...makeInput({ configOverrides: { timezone: "UTC" } }),
        now,
        schedules: [blockout],
      });
      expect(engine.getControlState("V1").blockoutChargeNotified).toBe(false);
    });
  });

  describe("schedule — branches", () => {
    it("adjusts amps when schedule amps differ from current", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({
          vehicle: { state: { isCharging: true, chargeAmps: 10 } },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 16,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("adjust_amps");
    });

    it("returns none when already at schedule amps", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z");
      const output = engine.decide({
        ...makeInput({
          vehicle: { state: { isCharging: true, chargeAmps: 16 } },
          configOverrides: { timezone: "UTC" },
        }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 16,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("none");
    });
  });

  describe("allocation — edge cases", () => {
    it("uses gross solar reference", () => {
      const engine = new ControllerEngine();
      const v1 = makeVehicle({ id: "V1", name: "EV 1", priority: 1 });
      const v2 = makeVehicle({ id: "V2", name: "EV 2", priority: 2 });
      const output = engine.decide({
        config: makeConfig({ solarReference: "gross" }),
        vehicles: [v1, v2],
        schedules: [],
        energy: makeEnergy({ solarProductionW: 5000, gridPowerW: 500 }),
        now: new Date("2026-01-01T12:00:00Z"),
        timestamp: Date.now(),
      });
      expect(output.decisions.get("V1")?.action).toBe("start");
    });

    it("uses grid voltage when charger reports low voltage", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        vehicle: { state: { chargerVoltage: 2 } },
        energyOverrides: { gridPowerW: -5000, gridVoltageV: 240 },
      }));
      // 5000W / 240V = 20A
      expect(output.decisions.get("V1")?.targetAmps).toBe(20);
    });

    it("uses config voltage when grid voltage is null", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: { gridVoltage: 230 },
        vehicle: { state: { chargerVoltage: 2 } },
        energyOverrides: { gridPowerW: -5000, gridVoltageV: null },
      }));
      // 5000W / 230V = 21A
      expect(output.decisions.get("V1")?.targetAmps).toBe(21);
    });
  });

  describe("schedules — time matching", () => {
    it("does not match when day is wrong", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T03:00:00Z"); // Thursday
      const output = engine.decide({
        ...makeInput({ configOverrides: { timezone: "UTC" } }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          scheduleType: "charge",
          startTime: "02:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed"],
          chargeAmps: 16,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.detail).not.toContain("schedule");
    });

    it("matches overnight schedule spanning midnight", () => {
      const engine = new ControllerEngine();
      const now = new Date("2026-01-01T23:30:00Z");
      const output = engine.decide({
        ...makeInput({ configOverrides: { timezone: "UTC" } }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          scheduleType: "charge",
          startTime: "22:00",
          endTime: "06:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 10,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("start");
      expect(output.decisions.get("V1")?.targetAmps).toBe(10);
    });

    it("uses local time when no timezone configured", () => {
      const engine = new ControllerEngine();
      const now = new Date();
      const hours = now.getHours();
      const output = engine.decide({
        ...makeInput({ configOverrides: { timezone: "" } }),
        now,
        schedules: [{
          id: "s1",
          vehicleId: null,
          scheduleType: "charge",
          startTime: `${String(hours).padStart(2, "0")}:00`,
          endTime: `${String((hours + 1) % 24).padStart(2, "0")}:00`,
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          chargeAmps: 12,
          chargeLimitPct: null,
          enabled: true,
        }],
      });
      expect(output.decisions.get("V1")?.action).toBe("start");
    });
  });

  describe("solar+grid fallback — charging above min", () => {
    it("adjusts to min when charging above min and solar insufficient", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();

      // Tick 1: charging at 10A, good solar, solar_grid mode
      engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { gridPowerW: -5000 },
        timestamp: baseTimestamp,
      }));

      // Tick 2: solar drops — grace starts, adjusts to min
      engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 3000 },
        timestamp: baseTimestamp + 60_000,
      }));

      // Tick 3: grace expires — solar_grid fallback, currently at min (5A)
      // but let's say vehicle is at 10A still → should adjust
      const output = engine.decide(makeInput({
        configOverrides: { solarTrackingMode: "solar_grid" },
        vehicle: { state: { isCharging: true, chargeAmps: 10 } },
        energyOverrides: { solarProductionW: 2000, gridPowerW: 3000 },
        timestamp: baseTimestamp + 7 * 60 * 1000,
      }));
      const d = output.decisions.get("V1");
      expect(d?.action).toBe("adjust_amps");
      expect(d?.targetAmps).toBe(5);
      expect(d?.detail).toContain("solar+grid");
    });
  });

  describe("min excess solar — passes when above threshold", () => {
    it("proceeds to solar tracking when excess meets minimum", () => {
      const engine = new ControllerEngine();
      // Excess = -gridPowerW = 3000W = 3kW, threshold = 2kW → passes
      const output = engine.decide(makeInput({
        configOverrides: { minExcessSolarKw: 2 },
        energyOverrides: { solarProductionW: 5000, gridPowerW: -3000 },
      }));
      expect(output.decisions.get("V1")?.action).toBe("start");
    });
  });

  describe("allocation — single vehicle waterfall", () => {
    it("returns empty allocation for single vehicle in waterfall mode", () => {
      const engine = new ControllerEngine();
      const output = engine.decide(makeInput({
        configOverrides: { priorityChargingEnabled: true },
        energyOverrides: { gridPowerW: -5000 },
      }));
      // Single vehicle — allocation returns empty, falls through to per-vehicle calc
      expect(output.decisions.get("V1")?.action).toBe("start");
    });
  });

  describe("amp debounce — target unchanged", () => {
    it("returns none when target matches current amps", () => {
      const engine = new ControllerEngine();
      const baseTimestamp = Date.now();
      // 13A * 230V = 2990W charging. To get target=13A from excess mode:
      // available = -gridPowerW + addBack = -gridPowerW + 2990
      // target = floor(available / 230) = 13 → available must be in [2990, 3220)
      // So -gridPowerW + 2990 = 3000 → gridPowerW = -10
      engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 13 } },
        energyOverrides: { gridPowerW: -10 },
        timestamp: baseTimestamp,
      }));

      const output = engine.decide(makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 13 } },
        energyOverrides: { gridPowerW: -10 },
        timestamp: baseTimestamp + 31_000,
      }));
      expect(output.decisions.get("V1")?.action).toBe("none");
    });
  });
});
