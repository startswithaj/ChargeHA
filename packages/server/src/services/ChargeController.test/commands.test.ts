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
      expect((await ctx.getBackoff()).backedOff).toBe(true);

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

  describe("charge_now — car-limited draw", () => {
    it("does not re-command amps when the car draws less than asked", async () => {
      // Car appetite 16A on a 32A charger: one adjust, then quiet.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 16, chargeAmpsMax: 32 },
        "charge_now",
      );

      await ctx.runOneLoop();
      const afterFirst = ctx.adapter.commands.length;
      expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 32 });

      await ctx.runOneLoop();
      await ctx.runOneLoop();

      expect(ctx.adapter.commands.length).toBe(afterFirst);
    });
  });

  describe("stopCharging — command backoff", () => {
    it("skips stop command when command backoff is active", async () => {
      ctx = await setupController({ isCharging: true }, "stop");
      ctx.adapter.stopChargingResult = false;
      await ctx.runOneLoop();

      expect((await ctx.getBackoff()).backedOff).toBe(true);
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

      expect((await ctx.getBackoff()).backedOff).toBe(true);
      expect((await ctx.getBackoff()).remainingMs).toBeGreaterThan(0);
    });

    it("handles non-Error thrown objects", async () => {
      // Already charging: an amp-command failure is only fatal (and only
      // feeds backoff) when there is no start to carry the limit instead.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 5 },
        "charge_now",
      );

      ctx.adapter.setChargeAmps = () => {
        throw "string error";
      };

      await ctx.runOneLoop();

      expect((await ctx.getBackoff()).backedOff).toBe(true);
    });
  });
});
