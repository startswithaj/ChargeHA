import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { CreateScheduleInput } from "../../db/types.ts";
import {
  BASE_ENERGY,
  type ControllerCtx,
  currentScheduleWindow,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — processAutoMode", () => {
  const activeBlockout = (
    overrides: Partial<CreateScheduleInput> = {},
  ): CreateScheduleInput => {
    const { today, startTime, endTime } = currentScheduleWindow();
    return {
      id: "sched-1",
      vehicleId: null,
      scheduleType: "blockout",
      startTime,
      endTime,
      days: [today],
      chargeAmps: null,
      chargeLimitPct: null,
      enabled: true,
      ...overrides,
    };
  };

  const activeChargeSchedule = (
    overrides: Partial<CreateScheduleInput> = {},
  ): CreateScheduleInput => {
    const { today, startTime, endTime } = currentScheduleWindow();
    return {
      id: "charge-sched",
      vehicleId: VIN,
      scheduleType: "charge",
      startTime,
      endTime,
      days: [today],
      chargeAmps: 16,
      chargeLimitPct: null,
      enabled: true,
      ...overrides,
    };
  };

  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("processAutoMode — blockout handling", () => {
    it("returns none when not charging during blockout", async () => {
      ctx = await setupController({ isCharging: false }, "auto");
      await ctx.db.createSchedule(activeBlockout());
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("Blocked by blockout schedule");
    });
  });

  describe("processAutoMode — schedule handling", () => {
    it("already charging at correct amps returns none", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 16 },
        "auto",
      );
      await ctx.db.createSchedule(activeChargeSchedule());
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toEqual([]);
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("Already charging at 16A");
    });

    it("adjusts amps when charging at different rate", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10 },
        "auto",
      );
      await ctx.db.createSchedule(activeChargeSchedule());
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({
        cmd: "setAmps",
        args: 16,
      });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("adjust_amps");
      expect(log?.actionDetail).toContain("Adjust to 16A");
    });

    it("uses chargeAmpsMax when schedule has null chargeAmps", async () => {
      ctx = await setupController({}, "auto");
      await ctx.db.createSchedule(activeChargeSchedule({ chargeAmps: null }));
      await ctx.runOneLoop();

      // chargeAmpsMax = 32 from BASE_STATE
      expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 32 });
      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
      const log = await ctx.getLastLogParsed();
      expect(log?.targetAmps).toBe(32);
    });

    it("global schedule (vehicleId=null) applies to vehicle", async () => {
      ctx = await setupController({}, "auto");
      await ctx.db.createSchedule(
        activeChargeSchedule({ vehicleId: null, chargeAmps: 20 }),
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 20 });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("start");
      expect(log?.targetAmps).toBe(20);
    });

    it("falls through to solar tracking when schedule limit is reached", async () => {
      ctx = await setupController(
        { batteryLevel: 70 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3000 },
      );
      await ctx.db.createSchedule(
        activeChargeSchedule({ chargeLimitPct: 70 }),
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) =>
            c.check === "charge_schedule" && c.result.includes("limit reached"),
        ),
      ).toBe(true);
      expect(log.checks.some((c) => c.check === "solar_tracking")).toBe(true);
    });

    it("shows 'max' in limit-reached message when schedule has null chargeAmps", async () => {
      ctx = await setupController(
        { batteryLevel: 70 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3000 },
      );
      await ctx.db.createSchedule(
        activeChargeSchedule({ chargeLimitPct: 70, chargeAmps: null }),
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) =>
            c.check === "charge_schedule" && c.result.includes("@ maxA") &&
            c.result.includes("limit reached"),
        ),
      ).toBe(true);
    });
  });

  describe("min excess solar", () => {
    it("does not stop charging immediately when excess drops below threshold", async () => {
      // Vehicle at 5A (1150W). Grid imports 1500W. Add-back excess = -350W,
      // below the 0.5kW threshold — grace handles, no hard stop.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 5, chargePowerKw: 1.15 },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 3000, gridPowerW: 1500 },
        { min_excess_solar_kw: "0.5" },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).not.toBe("stop");
      expect(log?.actionDetail).not.toContain("excess solar below minimum");
    });

    it("prevents starting when excess is below threshold", async () => {
      ctx = await setupController(
        { isCharging: false },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 3000, gridPowerW: 200 },
        { min_excess_solar_kw: "0.5" },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("excess solar below minimum");
    });
  });

  describe("processAutoMode — battery priority", () => {
    it("passes through when battery SoC is above limit", async () => {
      ctx = await setupController(
        {},
        "auto",
        { ...BASE_ENERGY, batterySoc: 90, gridPowerW: -3000 },
        {
          battery_priority_enabled: "true",
          battery_priority_limit: "80",
        },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) => c.check === "battery_priority" && c.result.includes("ok"),
        ),
      ).toBe(true);
      expect(log?.action).toBe("start");
    });

    it("shows no battery data when batterySoc is null", async () => {
      ctx = await setupController(
        {},
        "auto",
        { ...BASE_ENERGY, batterySoc: null, gridPowerW: -3000 },
        {
          battery_priority_enabled: "true",
          battery_priority_limit: "80",
        },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) =>
            c.check === "battery_priority" &&
            c.result.includes("no battery data"),
        ),
      ).toBe(true);
      expect(log?.action).toBe("start");
    });

    it("returns waiting when below limit and not charging", async () => {
      ctx = await setupController(
        { isCharging: false },
        "auto",
        { ...BASE_ENERGY, batterySoc: 40 },
        {
          battery_priority_enabled: "true",
          battery_priority_limit: "80",
        },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("Waiting for home battery");
    });

    it("skips with 'no energy data' when enabled but no energy snapshot", async () => {
      ctx = await setupController({}, "auto", null, {
        battery_priority_enabled: "true",
        battery_priority_limit: "80",
      });
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) =>
            c.check === "battery_priority" &&
            c.result.includes("skip (no energy data)"),
        ),
      ).toBe(true);
    });

    it("skips with 'disabled' when battery priority is off", async () => {
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
            c.check === "battery_priority" &&
            c.result.includes("skip (disabled)"),
        ),
      ).toBe(true);
    });
  });

  describe("processAutoMode — solar tracking entry and fallthrough", () => {
    it("shows 'skip (no energy data)' when solar enabled but no energy", async () => {
      ctx = await setupController({}, "auto", null);
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) =>
            c.check === "solar_tracking" &&
            c.result.includes("skip (no energy data)"),
        ),
      ).toBe(true);
    });

    it("shows 'disabled' when solar tracking is off", async () => {
      ctx = await setupController({}, "auto", BASE_ENERGY, {
        solar_tracking_enabled: "false",
      });
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) => c.check === "solar_tracking" && c.result === "disabled",
        ),
      ).toBe(true);
    });

    it("idles when no schedule and solar tracking disabled, not charging", async () => {
      ctx = await setupController({ isCharging: false }, "auto", BASE_ENERGY, {
        solar_tracking_enabled: "false",
      });
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("Idle");
    });

    it("stops when no schedule and solar tracking disabled, currently charging", async () => {
      ctx = await setupController({ isCharging: true }, "auto", BASE_ENERGY, {
        solar_tracking_enabled: "false",
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("stop");
      expect(log?.actionDetail).toContain("no schedule or solar tracking");
    });
  });
});
