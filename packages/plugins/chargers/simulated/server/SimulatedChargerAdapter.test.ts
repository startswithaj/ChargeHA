import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import type { CallContext } from "@chargeha/shared";
import { SimulatedChargerAdapter } from "./SimulatedChargerAdapter.ts";

describe("SimulatedChargerAdapter", () => {
  const c = (origin: string): CallContext => ({ origin, traceId: "test" });

  let adapter: SimulatedChargerAdapter;

  beforeEach(() => {
    adapter = new SimulatedChargerAdapter("charger-1");
  });

  describe("draw amps", () => {
    it("draws the car's appetite when it is below commanded amps", async () => {
      adapter.updateState({ carMaxAmps: 10 });
      await adapter.setChargeAmps(16, c("test:amps"));
      await adapter.startCharging(c("test:start"));

      const state = await adapter.getChargerState(c("test:state"));
      expect(state.chargeAmps).toBe(10);
    });

    it("draws the commanded amps when they are below the car's appetite", async () => {
      adapter.updateState({ carMaxAmps: 32 });
      await adapter.setChargeAmps(6, c("test:amps"));
      await adapter.startCharging(c("test:start"));

      const state = await adapter.getChargerState(c("test:state"));
      expect(state.chargeAmps).toBe(6);
    });
  });

  describe("status mapping", () => {
    it("reports suspended when energized off with a car plugged in", async () => {
      const state = await adapter.getChargerState(c("test:state"));
      expect(state.status).toBe("suspended");
    });

    it("reports charging while drawing amps", async () => {
      await adapter.startCharging(c("test:start"));

      const state = await adapter.getChargerState(c("test:state"));
      expect(state.status).toBe("charging");
    });

    it("reports no_draw when on with a zero-appetite car", async () => {
      adapter.updateState({ carMaxAmps: 0 });
      await adapter.startCharging(c("test:start"));

      const state = await adapter.getChargerState(c("test:state"));
      expect(state.status).toBe("no_draw");
    });

    it("reports available when unplugged", async () => {
      adapter.updateState({ pluggedIn: false });

      const state = await adapter.getChargerState(c("test:state"));
      expect(state.status).toBe("available");
    });
  });

  describe("stopCharging", () => {
    it("zeroes session energy", async () => {
      using fakeTime = new FakeTime();
      const sim = new SimulatedChargerAdapter("charger-1");
      await sim.startCharging(c("test:start"));
      await fakeTime.tickAsync(3_600_000); // 1 hour at the default 6A draw

      const charging = await sim.getChargerState(c("test:state"));
      expect(charging.energyAddedKwh).toBeGreaterThan(0);

      await sim.stopCharging(c("test:stop"));

      const stopped = await sim.getChargerState(c("test:state"));
      expect(stopped.energyAddedKwh).toBe(0);
    });
  });

  describe("unplug", () => {
    it("ends the session and forces amps to 0", async () => {
      using fakeTime = new FakeTime();
      const sim = new SimulatedChargerAdapter("charger-1");
      await sim.startCharging(c("test:start"));
      await fakeTime.tickAsync(3_600_000); // 1 hour at the default 6A draw

      sim.updateState({ pluggedIn: false });

      const state = await sim.getChargerState(c("test:state"));
      expect(state.chargeAmps).toBe(0);
      expect(state.energyAddedKwh).toBe(0);
      expect(state.isCharging).toBe(false);
    });
  });

  describe("energy accrual", () => {
    it("accrues energy proportional to wall-clock time while charging", async () => {
      using fakeTime = new FakeTime();
      const sim = new SimulatedChargerAdapter("charger-1");
      // Default commandedAmps 6A, carMaxAmps 16A -> draw 6A = 1.38kW.
      await sim.startCharging(c("test:start"));
      await fakeTime.tickAsync(3_600_000); // 1 hour

      const state = await sim.getChargerState(c("test:state"));
      expect(state.energyAddedKwh).toBeCloseTo(1.38, 2);
    });
  });
});
