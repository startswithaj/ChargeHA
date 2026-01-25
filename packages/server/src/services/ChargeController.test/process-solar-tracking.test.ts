import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  BASE_ENERGY,
  type ControllerCtx,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — processSolarTracking", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("processSolarTracking — additional branches", () => {
    it("uses 3 phases for three-phase charger config", async () => {
      // 3000W / (230V × 3 phases) = 4.3A → below min 5A → should not start.
      // (1-phase would give 13A and would start.)
      ctx = await setupController(
        { chargerVoltage: 230 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3000 },
        { three_phase_charger: "true" },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("insufficient solar");
    });

    it("prevents restart during cooldown period", async () => {
      // Enter cooldown via the natural grace-expiry path rather than mutating
      // private engine state, then verify a subsequent restart attempt is
      // blocked while cooldown is still active.
      ctx = await setupController(
        {
          isCharging: true,
          chargeAmps: 5,
          chargerVoltage: 230,
          chargePowerKw: 1.15,
        },
        "auto",
        {
          ...BASE_ENERGY,
          solarProductionW: 800,
          gridPowerW: 2000,
          homeConsumptionW: 2800,
        },
        {
          min_solar_generation_kw: "1",
          grace_period_minutes: "1",
          cooldown_period_minutes: "15",
        },
      );

      using fakeTime = new FakeTime();

      // Loop 1: enters grace period.
      await ctx.runOneLoop();

      // Loop 2: grace expires → controller stops and sets cooldown.
      fakeTime.tick(90_000);
      await ctx.runOneLoop();

      // Solar recovers — would otherwise trigger a restart.
      ctx.adapter.commands = [];
      ctx.adapter.state = {
        ...ctx.adapter.state,
        isCharging: false,
        chargeAmps: 0,
        chargePowerKw: 0,
      };
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
      assertExists(ctx.poller.snapshot);
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        solarProductionW: 5000,
        gridPowerW: -5000,
      };

      // Loop 3: still inside cooldown window — restart must be blocked.
      fakeTime.tick(60_000);
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(log?.actionDetail).toContain("ooldown");
      expect(
        log.checks.some(
          (c) => c.check === "cooldown" && c.result.includes("active"),
        ),
      ).toBe(true);
      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "start" });
    });

    it("applies large amp changes immediately", async () => {
      // Change > debounce threshold (2A) → applies immediately.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10, chargerVoltage: 230 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -5000 },
      );
      await ctx.runOneLoop();

      ctx.adapter.state.chargeAmps = 10;
      ctx.adapter.state.isCharging = true;
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
      ctx.adapter.commands = [];

      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.targetAmps).toBeGreaterThan(12);
    });

    it("debounces small amp changes until settled", async () => {
      // 1A diff is within debounce threshold → hold at 10A.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10, chargerVoltage: 230 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -300 },
      );
      await ctx.runOneLoop();

      ctx.adapter.state.chargeAmps = 10;
      ctx.adapter.state.isCharging = true;
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
      ctx.adapter.commands = [];

      ctx.poller.snapshot = {
        realtime: { ...BASE_ENERGY, gridPowerW: -300 },
        cumulative: {
          solarProducedWh: 0,
          gridImportedWh: 0,
          gridExportedWh: 0,
          dailySolarProducedWh: 0,
          dailyGridImportWh: 0,
          dailyGridExportWh: 0,
        },
      };
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(log?.targetAmps).toBe(10);
      expect(
        log.checks.some(
          (c) => c.check === "amp_debounce" && c.result.includes("settling"),
        ),
      ).toBe(true);
    });

    it("applies large downward amp changes immediately", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 15, chargerVoltage: 230 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3500 },
      );
      await ctx.runOneLoop();

      ctx.adapter.state.chargeAmps = 15;
      ctx.adapter.state.isCharging = true;
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
      ctx.adapter.commands = [];

      ctx.poller.snapshot = {
        realtime: { ...BASE_ENERGY, gridPowerW: 2000 },
        cumulative: {
          solarProducedWh: 0,
          gridImportedWh: 0,
          gridExportedWh: 0,
          dailySolarProducedWh: 0,
          dailyGridImportWh: 0,
          dailyGridExportWh: 0,
        },
      };
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.targetAmps).toBeLessThan(13);
    });

    it("returns none when already charging at target amps", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 13, chargerVoltage: 230 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -10 },
      );
      await ctx.runOneLoop();

      ctx.adapter.state.chargeAmps = 13;
      ctx.adapter.state.isCharging = true;
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
      ctx.adapter.commands = [];

      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("Already charging at 13A");
    });

    it("grace period with vehicle already at min amps does not send adjust", async () => {
      ctx = await setupController(
        {
          isCharging: true,
          chargeAmps: 5,
          chargeAmpsMin: 5,
          chargerVoltage: 230,
          chargePowerKw: 1.15,
        },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 500, gridPowerW: 300 },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.actionDetail).toContain("Grace period active");
      expect(ctx.adapter.commands).not.toContainEqual({
        cmd: "setAmps",
        args: 5,
      });
    });

    it("stops and sets cooldown when grace period expires", async () => {
      ctx = await setupController(
        {
          isCharging: true,
          chargeAmps: 5,
          chargerVoltage: 230,
          chargePowerKw: 1.15,
        },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 500, gridPowerW: 300 },
        { grace_period_minutes: "1" },
      );

      using fakeTime = new FakeTime();

      // Loop 1: enters grace period (insufficient excess solar).
      await ctx.runOneLoop();
      ctx.adapter.commands = [];

      // Loop 2: tick past grace_period_minutes — controller must stop and
      // arm cooldown via the natural state machine.
      fakeTime.tick(90_000);
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("stop");
      expect(log?.actionDetail).toContain("grace period expired");
    });

    it("uses gross solar reference when configured", async () => {
      // Gross mode: available = solarProductionW - margin (5000 - 200 = 4800W → 20A).
      // Excess mode would give 0A from gridPowerW=+1000 (importing).
      ctx = await setupController(
        { chargerVoltage: 230 },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 5000, gridPowerW: 1000 },
        { solar_reference: "gross" },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(log.action).toBe("start");
      expect(log.targetAmps).toBeGreaterThanOrEqual(5);
    });

    it("not charging below min solar reports correct detail", async () => {
      ctx = await setupController(
        { isCharging: false },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 100, gridPowerW: -50 },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain(
        "Not charging — below minimum solar generation",
      );
    });
  });
});
