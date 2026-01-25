import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  type ControllerCtx,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — processVehicle", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("processVehicle — no vehicle state", () => {
    it("returns none with 'No vehicle state available' when state is null", async () => {
      // skipInitialState leaves the middleware cache empty; with the adapter
      // also rejecting, the controller's first loop sees getState() === null.
      ctx = await setupController({}, "auto", BASE_ENERGY, {}, {
        skipInitialState: true,
      });
      ctx.adapter.getChargeState = () =>
        Promise.reject(new Error("adapter offline"));

      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("No vehicle state available");
      expect(
        log.checks.some(
          (c) =>
            c.check === "vehicle_state" && c.result.includes("no state yet"),
        ),
      ).toBe(true);
    });
  });

  describe("processVehicle — location check", () => {
    it("suspends automation when vehicle is away from home", async () => {
      ctx = await setupController(
        { latitude: -37.8136, longitude: 144.9631 }, // Melbourne CBD
        "auto",
        BASE_ENERGY,
        {
          home_latitude: "-33.8688", // Sydney — >800km away
          home_longitude: "151.2093",
        },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("Away from home");
    });

    it("reports 'home' in location check when vehicle is at home", async () => {
      ctx = await setupController(
        { latitude: -37.8136, longitude: 144.9631 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3000 },
        {
          home_latitude: "-37.8136",
          home_longitude: "144.9631",
        },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some((c) => c.check === "location" && c.result === "home"),
      ).toBe(true);
    });

    it("reports 'unknown (assuming home)' when location is null", async () => {
      ctx = await setupController(
        {},
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3000 },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) =>
            c.check === "location" && c.result === "unknown (assuming home)",
        ),
      ).toBe(true);
    });
  });

  describe("processVehicle — battery at limit when charging", () => {
    it("sends stop and logs 'Stop — battery at charge limit' when charging at limit", async () => {
      ctx = await setupController({
        batteryLevel: 80,
        chargeLimit: 80,
        isCharging: true,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("stop");
      expect(log?.actionDetail).toContain("Stop — battery at charge limit");
    });

    it("logs 'Already stopped — battery at limit' when not charging at limit", async () => {
      ctx = await setupController({
        batteryLevel: 80,
        chargeLimit: 80,
        isCharging: false,
      });
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("Already stopped — battery at limit");
    });
  });

  describe("processVehicle — charge_now adjust amps", () => {
    it("adjusts amps when charging at different rate than max", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10 },
        "charge_now",
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({
        cmd: "setAmps",
        args: 32,
      });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("adjust_amps");
      expect(log?.actionDetail).toContain("Adjust to 32A (charge_now)");
    });
  });
});
