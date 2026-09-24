import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import {
  makeConfig,
  makeEnergy,
  makeInput,
  makeVehicle,
} from "../test-helpers/controller-engine.ts";

describe("ControllerEngine — displacement by a higher-priority vehicle", () => {
  // 230 V single phase: 1 A ≈ 230 W. Excess mode adds back charging draw, so
  // total available = -grid + Σ(chargeAmps × 230). A vehicle's own view
  // (rawAmps) adds back only its own draw.
  const T0 = 1_000_000;
  const MINUTE = 60_000;
  const waterfall = makeConfig({ priorityChargingEnabled: true });

  type StateOverrides = NonNullable<Parameters<typeof makeVehicle>[0]>["state"];
  const p1 = (state: StateOverrides) =>
    makeVehicle({
      id: "P1",
      name: "P1",
      priority: 1,
      state: { chargeAmpsMax: 32, ...state },
    });
  const p2 = (state: StateOverrides) =>
    makeVehicle({
      id: "P2",
      name: "P2",
      priority: 2,
      state: { chargeAmpsMax: 32, ...state },
    });

  it("stops P2 the tick P1 arrives and takes the solar (no grace)", () => {
    const engine = new ControllerEngine();
    // P2 charging alone at 18A, exporting 800W. P1 plugs in. Total = 800 +
    // 4140 = 4940W → 21A, all to P1. P2's own view: 21A ≥ min, allocated 0.
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isPluggedIn: true }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -800 }),
      timestamp: T0,
    }));
    expect(out.decisions.get("P1")?.action).toBe("start");
    const d2 = out.decisions.get("P2");
    expect(d2?.action).toBe("stop");
    expect(d2?.reason).toBe("displaced");
    expect(engine.getControlState("P2").cooldownUntil).toBe(T0 + 15 * MINUTE);
  });

  it("stops P2 on arrival even when it is left with a few amps, not zero", () => {
    const engine = new ControllerEngine();
    // P1 max 16. Exporting 400W: total = 400 + 4140 = 4540W → 19A → P1 16,
    // P2 3. P2's own view: 19A ≥ min.
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isPluggedIn: true, chargeAmpsMax: 16 }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -400 }),
      timestamp: T0,
    }));
    expect(engine.getControlState("P2").allocatedAmps).toBe(3);
    expect(out.decisions.get("P2")?.reason).toBe("displaced");
  });

  it("keeps P2 in cooldown after displacement even when solar frees up", () => {
    const engine = new ControllerEngine();
    engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isPluggedIn: true }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -800 }),
      timestamp: T0,
    }));
    // P1 at its 16A max, P2 stopped, exporting 3000W → 29A → P1 16, P2 13.
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isCharging: true, chargeAmps: 16, chargeAmpsMax: 16 }),
        p2({ isCharging: false }),
      ],
      energy: makeEnergy({ gridPowerW: -3000 }),
      timestamp: T0 + MINUTE,
    }));
    expect(out.decisions.get("P2")?.reason).toBe("cooldown");
  });

  it("gives P1 its grace period when a dip drops it to zero (not displaced)", () => {
    const engine = new ControllerEngine();
    // P1 charging 16A, P2 idle. Production 1100W, importing 3700W. Total =
    // -3700 + 3680 < 0 → 0A for everyone. P1's own view is also 0A.
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isCharging: true, chargeAmps: 16 }),
        p2({ isCharging: false }),
      ],
      energy: makeEnergy({ solarProductionW: 1100, gridPowerW: 3700 }),
      timestamp: T0,
    }));
    expect(engine.getControlState("P1").allocatedAmps).toBe(0);
    const d1 = out.decisions.get("P1");
    expect(d1?.reason).toBe("grace_period");
    expect(d1?.action).not.toBe("stop");
  });

  it("keeps P2 on grace when a cloud shrinks both shares", () => {
    const engine = new ControllerEngine();
    // Both charging: P1 16A (max), P2 8A. Cloud, importing 1100W. Total =
    // -1100 + 3680 + 1840 = 4420W → 19A → P1 16, P2 3. P2's own view:
    // -1100 + 1840 = 740W → 3A < min. Solar is short for P2 too — a dip.
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isCharging: true, chargeAmps: 16, chargeAmpsMax: 16 }),
        p2({ isCharging: true, chargeAmps: 8 }),
      ],
      energy: makeEnergy({ gridPowerW: 1100 }),
      timestamp: T0,
    }));
    const d2 = out.decisions.get("P2");
    expect(d2?.reason).toBe("grace_period");
    expect(d2?.action).toBe("adjust_amps");
    expect(engine.getControlState("P2").cooldownUntil).toBeNull();
  });

  it("leaves solar_grid mode to the grid fallback instead of stopping", () => {
    const engine = new ControllerEngine();
    const out = engine.decide(makeInput({
      config: makeConfig({
        priorityChargingEnabled: true,
        solarTrackingMode: "solar_grid",
      }),
      vehicles: [
        p1({ isPluggedIn: true }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -800 }),
      timestamp: T0,
    }));
    expect(out.decisions.get("P2")?.action).not.toBe("stop");
    expect(out.decisions.get("P2")?.reason).toBe("grace_period");
  });

  it("never fires in equal mode", () => {
    const engine = new ControllerEngine();
    const out = engine.decide(makeInput({
      config: makeConfig({ priorityChargingEnabled: false }),
      vehicles: [
        p1({ isPluggedIn: true }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -800 }),
      timestamp: T0,
    }));
    expect(out.decisions.get("P2")?.reason).not.toBe("displaced");
  });

  it("never fires for a single vehicle", () => {
    const engine = new ControllerEngine();
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: [p2({ isCharging: true, chargeAmps: 18 })],
      energy: makeEnergy({ gridPowerW: 3000 }),
      timestamp: T0,
    }));
    expect(engine.getControlState("P2").allocatedAmps).toBeNull();
    expect(out.decisions.get("P2")?.reason).not.toBe("displaced");
  });
});
