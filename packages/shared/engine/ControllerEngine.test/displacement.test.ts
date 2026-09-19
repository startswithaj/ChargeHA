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
  // 230 V single phase: 1 A ≈ 230 W. Excess mode adds back every charging
  // vehicle's draw, so available = -grid + Σ(chargeAmps × 230).
  const T0 = 1_000_000;
  const MINUTE = 60_000;
  const waterfall = makeConfig({ priorityChargingEnabled: true });

  const p1 = (
    state: Parameters<typeof makeVehicle>[0] extends infer O
      ? O extends { state?: infer S } ? S : never
      : never,
  ) =>
    makeVehicle({
      id: "P1",
      name: "P1",
      priority: 1,
      state: { chargeAmpsMax: 32, ...state },
    });
  const p2 = (state: Parameters<typeof p1>[0]) =>
    makeVehicle({
      id: "P2",
      name: "P2",
      priority: 2,
      state: { chargeAmpsMax: 32, ...state },
    });

  it("stops P2 the tick P1 arrives and takes the solar (no grace)", () => {
    const engine = new ControllerEngine();

    // Tick 1: P1 not plugged in. P2 charging alone at 18A, exporting 800W.
    engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isPluggedIn: false }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -800 }),
      timestamp: T0,
    }));

    // Tick 2: P1 plugs in. Available = 800 + 18×230 = 4940W → 21A.
    // Waterfall gives P1 all 21A, P2 0A.
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isPluggedIn: true }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -800 }),
      timestamp: T0 + MINUTE,
    }));

    expect(out.decisions.get("P1")?.action).toBe("start");
    const d2 = out.decisions.get("P2");
    expect(d2?.action).toBe("stop");
    expect(d2?.reason).toBe("displaced");
    expect(engine.getControlState("P2").cooldownUntil).toBe(
      T0 + MINUTE + 15 * MINUTE,
    );
  });

  it("keeps P2 in cooldown after displacement even when solar frees up", () => {
    const engine = new ControllerEngine();
    const ticks = [
      [p1({ isPluggedIn: false }), p2({ isCharging: true, chargeAmps: 18 })],
      [p1({ isPluggedIn: true }), p2({ isCharging: true, chargeAmps: 18 })],
      // P1 charging at its 16A max, P2 stopped, exporting 3000W.
      // Available = 3000 + 3680 = 6680W → 29A → P1 16, P2 13.
      [
        p1({ isCharging: true, chargeAmps: 16, chargeAmpsMax: 16 }),
        p2({ isCharging: false }),
      ],
    ];
    const outputs = ticks.map((vehicles, i) =>
      engine.decide(makeInput({
        config: waterfall,
        vehicles,
        energy: makeEnergy({ gridPowerW: i === 2 ? -3000 : -800 }),
        timestamp: T0 + i * MINUTE,
      }))
    );
    expect(outputs[1].decisions.get("P2")?.reason).toBe("displaced");
    expect(outputs[2].decisions.get("P2")?.reason).toBe("cooldown");
  });

  it("gives P1 its grace period when a dip drops it below minimum (not displaced)", () => {
    const engine = new ControllerEngine();

    // Tick 1: P1 charging 16A, P2 plugged in idle, exporting 1150W.
    // Available = 1150 + 3680 = 4830W → 21A → P1 21 (clamped by its own
    // draw later), P2 0.
    engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isCharging: true, chargeAmps: 16 }),
        p2({ isCharging: false }),
      ],
      energy: makeEnergy({ gridPowerW: -1150 }),
      timestamp: T0,
    }));

    // Tick 2: cloud. Production 1100W (above the 1kW minimum), importing
    // 3700W. Available = -3700 + 3680 < 0 → 0A → P1 0, P2 0. Nobody above
    // P1 exists, so 0A is a dip, not displacement.
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: [
        p1({ isCharging: true, chargeAmps: 16 }),
        p2({ isCharging: false }),
      ],
      energy: makeEnergy({ solarProductionW: 1100, gridPowerW: 3700 }),
      timestamp: T0 + MINUTE,
    }));
    expect(engine.getControlState("P1").allocatedAmps).toBe(0);

    const d1 = out.decisions.get("P1");
    expect(d1?.reason).toBe("grace_period");
    expect(d1?.action).not.toBe("stop");
    expect(engine.getControlState("P1").displaced).toBe(false);
  });

  it("keeps P2 on grace when a cloud shrinks both shares (P1 did not grow)", () => {
    const engine = new ControllerEngine();
    const both = [
      p1({ isCharging: true, chargeAmps: 16, chargeAmpsMax: 16 }),
      p2({ isCharging: true, chargeAmps: 8 }),
    ];

    // Tick 1: exporting 200W. Available = 200 + 3680 + 1840 = 5720W → 24A.
    // P1 16 (max), P2 8.
    engine.decide(makeInput({
      config: waterfall,
      vehicles: both,
      energy: makeEnergy({ gridPowerW: -200 }),
      timestamp: T0,
    }));

    // Tick 2: cloud, importing 1100W. Available = 4420W → 19A.
    // P1 still 16, P2 3 — below min, but P1's share did not grow.
    const out = engine.decide(makeInput({
      config: waterfall,
      vehicles: both,
      energy: makeEnergy({ gridPowerW: 1100 }),
      timestamp: T0 + MINUTE,
    }));

    const d2 = out.decisions.get("P2");
    expect(d2?.reason).toBe("grace_period");
    expect(d2?.action).toBe("adjust_amps");
    expect(engine.getControlState("P2").displaced).toBe(false);
    expect(engine.getControlState("P2").cooldownUntil).toBeNull();
  });

  it("never flags displacement in equal mode", () => {
    const engine = new ControllerEngine();
    const equal = makeConfig({ priorityChargingEnabled: false });
    engine.decide(makeInput({
      config: equal,
      vehicles: [
        p1({ isPluggedIn: false }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -800 }),
      timestamp: T0,
    }));
    const out = engine.decide(makeInput({
      config: equal,
      vehicles: [
        p1({ isPluggedIn: true }),
        p2({ isCharging: true, chargeAmps: 18 }),
      ],
      energy: makeEnergy({ gridPowerW: -800 }),
      timestamp: T0 + MINUTE,
    }));
    expect(engine.getControlState("P2").displaced).toBe(false);
    expect(out.decisions.get("P2")?.reason).not.toBe("displaced");
  });

  it("never flags a single vehicle", () => {
    const engine = new ControllerEngine();
    engine.decide(makeInput({
      config: waterfall,
      vehicles: [p2({ isCharging: true, chargeAmps: 18 })],
      energy: makeEnergy({ gridPowerW: 3000 }),
      timestamp: T0,
    }));
    expect(engine.getControlState("P2").displaced).toBe(false);
  });
});
