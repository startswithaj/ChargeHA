import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";

describe("ControllerEngine — min solar generation while charging", () => {
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
    // Non-zero production while charging never stops on the spot — the grace
    // period owns the dip.
    const d = output.decisions.get("V1");
    expect(d?.action).not.toBe("stop");
    expect(d?.detail).not.toContain("below minimum solar generation");
  });

  it("starts the grace period when production drops below the minimum", () => {
    const engine = new ControllerEngine();
    // Plenty of surplus for 8A, but production is under the 1 kW minimum.
    const output = engine.decide(makeInput({
      vehicle: { state: { isCharging: true, chargeAmps: 8 } },
      energyOverrides: { solarProductionW: 900, gridPowerW: -900 },
    }));
    const d = output.decisions.get("V1");
    expect(d?.reason).toBe("grace_period");
    expect(d?.detail).toContain("solar generation below minimum");
    expect(d?.checks.some((c) => c.check === "grace_period")).toBe(true);
  });

  it("stops after the grace period when production stays below the minimum", () => {
    const engine = new ControllerEngine();
    const baseTimestamp = Date.now();
    const input = () =>
      makeInput({
        vehicle: { state: { isCharging: true, chargeAmps: 5 } },
        energyOverrides: { solarProductionW: 900, gridPowerW: -900 },
      });

    engine.decide({ ...input(), timestamp: baseTimestamp });
    const output = engine.decide({
      ...input(),
      timestamp: baseTimestamp + 7 * 60 * 1000,
    });
    expect(output.decisions.get("V1")?.action).toBe("stop");
  });
});

describe("ControllerEngine — home battery discharge", () => {
  it("does not treat battery discharge as available solar", () => {
    // Real-world case: ESS holds the grid at ~0 by discharging ~2kW while the
    // car pulls 8A and the panels make 144W. The car must not ride the house
    // battery down.
    const engine = new ControllerEngine();
    const baseTimestamp = Date.now();
    const input = () =>
      makeInput({
        vehicle: {
          state: {
            isCharging: true,
            chargeAmps: 8,
            chargeAmpsMin: 5,
            chargeAmpsMax: 15,
            chargerVoltage: 236,
          },
        },
        energyOverrides: {
          solarProductionW: 144,
          gridPowerW: 2,
          homeConsumptionW: 2212,
          batteryPowerW: 2066,
        },
      });

    const first = engine.decide({ ...input(), timestamp: baseTimestamp });
    expect(first.decisions.get("V1")?.reason).toBe("grace_period");
    expect(first.decisions.get("V1")?.checks).toContainEqual({
      check: "solar_tracking",
      result: "available 0W → 0A (clamped 5-15)",
    });

    const later = engine.decide({
      ...input(),
      timestamp: baseTimestamp + 7 * 60 * 1000,
    });
    expect(later.decisions.get("V1")?.action).toBe("stop");
  });

  it("still charges from real surplus while the battery is idle", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      vehicle: { state: { isCharging: false } },
      energyOverrides: {
        solarProductionW: 5000,
        gridPowerW: -3000,
        batteryPowerW: 0,
      },
    }));
    const d = output.decisions.get("V1");
    expect(d?.action).toBe("start");
    expect(d?.targetAmps).toBe(13);
  });
});
