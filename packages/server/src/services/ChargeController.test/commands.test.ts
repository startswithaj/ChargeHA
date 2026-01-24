import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  type ControllerCtx,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — commands + backoff", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("startChargingAt — command backoff", () => {
    it("skips sending commands when command backoff is active", async () => {
      ctx = await setupController({ isCharging: false }, "charge_now");
      ctx.adapter.startChargingResult = false;
      await ctx.runOneLoop();
      expect(ctx.manager.isBackedOff(VIN).backedOff).toBe(true);

      ctx.adapter.startChargingResult = true;
      ctx.adapter.commands = [];

      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toEqual([]);
    });
  });

  describe("startChargingAt — updates cached state after amp change", () => {
    it("updates cached state when amps change", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10 },
        "charge_now",
      );

      await ctx.runOneLoop();

      const state = await ctx.manager.getState(VIN);
      assertExists(state);
      expect(state.chargeAmps).toBe(32);
    });
  });

  describe("stopCharging — command backoff", () => {
    it("skips stop command when command backoff is active", async () => {
      ctx = await setupController({ isCharging: true }, "stop");
      ctx.adapter.stopChargingResult = false;
      await ctx.runOneLoop();

      expect(ctx.manager.isBackedOff(VIN).backedOff).toBe(true);
      ctx.adapter.commands = [];

      ctx.adapter.state.isCharging = true;
      ctx.adapter.stopChargingResult = true;
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);

      await ctx.runOneLoop();

      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
    });
  });

  describe("stopCharging — updates cached state after stop", () => {
    it("updates cached state to reflect stopped charging", async () => {
      ctx = await setupController({ isCharging: true }, "stop");

      await ctx.runOneLoop();

      const state = await ctx.manager.getState(VIN);
      assertExists(state);
      expect(state.isCharging).toBe(false);
      expect(state.chargePowerKw).toBe(0);
    });
  });

  describe("command backoff (via VehicleManager)", () => {
    it("backoff is active after command failure", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 5 },
        "charge_now",
      );
      ctx.adapter.setChargeAmpsResult = false;

      await ctx.runOneLoop();

      expect(ctx.manager.isBackedOff(VIN).backedOff).toBe(true);
      expect(ctx.manager.isBackedOff(VIN).remainingMs).toBeGreaterThan(0);
    });

    it("handles non-Error thrown objects", async () => {
      ctx = await setupController({}, "charge_now");

      ctx.adapter.setChargeAmps = () => {
        throw "string error";
      };

      await ctx.runOneLoop();

      expect(ctx.manager.isBackedOff(VIN).backedOff).toBe(true);
    });
  });
});
