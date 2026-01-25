import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  type ControllerCtx,
  currentScheduleWindow,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — edge cases", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("loop — error handling", () => {
    it("continues scheduling after loop error", async () => {
      ctx = await setupController({}, "auto");
      const db = ctx.db;

      const origGetVehicles = db.getVehicles.bind(db);
      let errorThrown = false;
      db.getVehicles = () => {
        errorThrown = true;
        db.getVehicles = origGetVehicles;
        throw new Error("test error");
      };

      await ctx.runOneLoop();
      expect(errorThrown).toBe(true);

      // Subsequent loop should work normally
      await ctx.runOneLoop();
      const { total } = await ctx.db.logs.getControllerLogs({
        limit: 10,
        offset: 0,
      });
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });

  describe("disabled schedules", () => {
    it("ignores disabled blockout schedule", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({}, "auto", null);
      await ctx.db.createSchedule({
        id: "disabled-blockout",
        vehicleId: null,
        scheduleType: "blockout",
        startTime,
        endTime,
        days: [today],
        chargeAmps: null,
        chargeLimitPct: null,
        enabled: false,
      });
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
      expect(log?.actionDetail).toContain("no schedule or solar tracking");
    });

    it("ignores disabled charge schedule", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({}, "auto", null);
      await ctx.db.createSchedule({
        id: "disabled-charge",
        vehicleId: VIN,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: false,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toHaveLength(0);
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
    });
  });
});
