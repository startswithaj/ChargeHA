import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  type ControllerCtx,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — priority + logging + lifecycle", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("battery priority", () => {
    it("stops charging when home battery is below priority limit", async () => {
      ctx = await setupController(
        { isCharging: true },
        "auto",
        { ...BASE_ENERGY, batterySoc: 40 },
        {
          battery_priority_enabled: "true",
          battery_priority_limit: "80",
        },
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(log?.action).toBe("stop");
      expect(
        log.checks.some(
          (c) => c.check === "battery_priority" && c.result.includes("hold"),
        ),
      ).toBe(true);
    });
  });

  describe("decision logging", () => {
    it("creates a log entry for each vehicle each loop", async () => {
      ctx = await setupController({}, "auto");
      await ctx.runOneLoop();

      const { total } = await ctx.db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
      });
      expect(total).toBe(1);
    });

    it("log entry contains energy inputs snapshot", async () => {
      ctx = await setupController({}, "auto");
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      const inputs = log?.inputs as {
        energy: { solarProductionW: number; gridPowerW: number };
      };
      expect(inputs.energy).not.toBeNull();
      expect(inputs.energy.solarProductionW).toBe(5000);
      expect(inputs.energy.gridPowerW).toBe(-2000);
    });

    it("log entry contains vehicle state snapshot", async () => {
      ctx = await setupController({}, "auto");
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      const inputs = log?.inputs as {
        vehicleState: { batteryLevel: number; isPluggedIn: boolean };
      };
      expect(inputs.vehicleState).not.toBeNull();
      expect(inputs.vehicleState.batteryLevel).toBe(60);
      expect(inputs.vehicleState.isPluggedIn).toBe(true);
    });

    it("log entry contains checks array", async () => {
      ctx = await setupController({}, "auto");
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(Array.isArray(log.checks)).toBe(true);
      expect(log.checks.length).toBeGreaterThan(0);
      log.checks.forEach((c) => {
        expect(typeof c.check).toBe("string");
        expect(typeof c.result).toBe("string");
      });
    });

    it("logs 'Charging disabled' when charging is disabled", async () => {
      ctx = await setupController({}, "auto", BASE_ENERGY, {
        charging_enabled: "false",
      });
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toBe("Charging disabled");
    });
  });

  describe("first-cycle initialization", () => {
    it("does not fire external_charge on first loop when vehicle is already charging", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10 },
        "charge_now",
      );
      await ctx.runOneLoop();

      const externalEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_external_charge",
      );
      expect(externalEvents).toHaveLength(0);
    });

    it("does not fire charge_started on first loop when vehicle is already charging", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10 },
        "charge_now",
      );
      await ctx.runOneLoop();

      const startEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_charge_started",
      );
      expect(startEvents).toHaveLength(0);
    });

    it("detects external charge on second loop after initialization", async () => {
      // Start with vehicle not charging, mode=stop so controller won't start it
      ctx = await setupController({}, "stop");
      await ctx.runOneLoop();
      expect(ctx.trackingEmitter.controllerEvents()).toHaveLength(0);

      // Simulate vehicle starts charging externally between loops
      ctx.adapter.state.isCharging = true;
      ctx.adapter.state.chargeAmps = 16;
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);

      await ctx.runOneLoop();

      const externalEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_external_charge",
      );
      expect(externalEvents).toHaveLength(1);
    });
  });
});
