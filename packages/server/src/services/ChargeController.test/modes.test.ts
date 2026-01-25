// Tests that mode dispatch (auto/charge_now/stop) drives the right adapter
// commands and decision logs, including not-plugged-in and battery-at-limit
// short-circuits.

import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  BASE_ENERGY,
  type ControllerCtx,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — modes", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("mode: stop", () => {
    it("sends stop command when vehicle is charging", async () => {
      ctx = await setupController({ isCharging: true }, "stop");
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("stop");
    });

    it("does not send stop when already stopped", async () => {
      ctx = await setupController({ isCharging: false }, "stop");
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toEqual([]);
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
    });
  });

  describe("mode: charge_now", () => {
    it("starts charging at max amps", async () => {
      ctx = await setupController({}, "charge_now");
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
      expect(ctx.adapter.commands).toContainEqual({
        cmd: "setAmps",
        args: 32,
      });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("start");
      expect(log?.targetAmps).toBe(32);
    });

    it("does not re-send when already charging at max", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 32 },
        "charge_now",
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toEqual([]);
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
    });
  });

  describe("not plugged in", () => {
    it("skips processing and logs none", async () => {
      ctx = await setupController({ isPluggedIn: false });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toEqual([]);
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("Not plugged in");
    });
  });

  describe("battery at limit", () => {
    it("stops charging when battery >= charge limit", async () => {
      ctx = await setupController({
        batteryLevel: 80,
        chargeLimit: 80,
        isCharging: true,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("stop");
    });

    it("does not retry startCharging when battery is within 1% of limit and car stopped", async () => {
      ctx = await setupController({
        batteryLevel: 99,
        chargeLimit: 100,
        isCharging: false,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toEqual([]);
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("within 1%");
    });

    it("lets car continue charging when at 99% with 100% limit", async () => {
      ctx = await setupController({
        batteryLevel: 99,
        chargeLimit: 100,
        isCharging: true,
        chargePowerKw: 1.5,
      });
      await ctx.runOneLoop();

      // Should NOT stop — let the car finish naturally
      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).not.toBe("stop");
    });

    it("does not apply near-limit tolerance at lower charge limits", async () => {
      ctx = await setupController(
        {
          batteryLevel: 79,
          chargeLimit: 80,
          isCharging: false,
        },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3000 },
      );
      await ctx.runOneLoop();

      // 79% < 80% and not within tolerance — should start charging
      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
    });
  });
});
