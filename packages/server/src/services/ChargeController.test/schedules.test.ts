import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  BASE_ENERGY,
  type ControllerCtx,
  currentScheduleWindow,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — schedules", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("blockout schedule", () => {
    it("stops charging during active blockout", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({ isCharging: true }, "auto");
      await ctx.db.createSchedule({
        id: "blockout-1",
        vehicleId: null,
        chargerId: null,
        scheduleType: "blockout",
        startTime,
        endTime,
        days: [today],
        chargeAmps: null,
        chargeLimitPct: null,
        enabled: true,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(log?.action).toBe("stop");
      expect(
        log.checks.some(
          (c) => c.check === "blockout_schedule" && c.result.includes("active"),
        ),
      ).toBe(true);
    });
  });

  describe("charge schedule", () => {
    it("charges at scheduled amps for a charger-keyed schedule", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({}, "auto");
      const charger = (await ctx.db.getChargers())
        .find((c) => c.vehicleId === VIN);
      assertExists(charger);
      await ctx.db.createSchedule({
        id: "charge-charger-1",
        vehicleId: null,
        chargerId: charger.id,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 14,
        chargeLimitPct: null,
        enabled: true,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 14 });
      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
    });

    it("ignores a charge schedule keyed to a different charger", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({}, "auto", null);
      await ctx.db.createSchedule({
        id: "charge-other-1",
        vehicleId: null,
        chargerId: "some-other-charger",
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 14,
        chargeLimitPct: null,
        enabled: true,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toEqual([]);
    });

    it("charges at scheduled amps during active schedule", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({}, "auto");
      await ctx.db.createSchedule({
        id: "charge-1",
        vehicleId: VIN,
        chargerId: null,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
      expect(ctx.adapter.commands).toContainEqual({
        cmd: "setAmps",
        args: 16,
      });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("start");
      expect(log?.targetAmps).toBe(16);
    });
  });

  describe("overlapping charger and vehicle schedules", () => {
    // Both schedules target the same charging point: one keyed to the charger,
    // one keyed to the car resolved as plugged into it.
    const addOverlappingPair = async (
      c: ControllerCtx,
      chargerId: string,
      order: "charger-first" | "vehicle-first",
    ) => {
      const { today, startTime, endTime } = currentScheduleWindow();
      const chargerSchedule = {
        id: "merge-charger",
        vehicleId: null,
        chargerId,
        scheduleType: "charge" as const,
        startTime,
        endTime,
        days: [today],
        chargeAmps: 32,
        chargeLimitPct: null,
        enabled: true,
      };
      const vehicleSchedule = {
        ...chargerSchedule,
        id: "merge-vehicle",
        vehicleId: VIN,
        chargerId: null,
        chargeAmps: 10,
        chargeLimitPct: 80,
      };
      const ordered = order === "charger-first"
        ? [chargerSchedule, vehicleSchedule]
        : [vehicleSchedule, chargerSchedule];
      // Sequential inserts so the rows land in the requested order.
      await ordered.reduce(
        async (prev, s) => {
          await prev;
          await c.db.createSchedule(s);
        },
        Promise.resolve(),
      );
    };

    const findCharger = async (c: ControllerCtx) => {
      const charger = (await c.db.getChargers()).find((r) =>
        r.vehicleId === VIN
      );
      assertExists(charger);
      return charger;
    };

    it("charges at the charger schedule's amps below the vehicle limit", async () => {
      ctx = await setupController({ batteryLevel: 50 }, "auto");
      await addOverlappingPair(
        ctx,
        (await findCharger(ctx)).id,
        "charger-first",
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 32 });
      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
    });

    it("issues the same commands whichever schedule was created first", async () => {
      ctx = await setupController({ batteryLevel: 50 }, "auto");
      await addOverlappingPair(
        ctx,
        (await findCharger(ctx)).id,
        "vehicle-first",
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "setAmps", args: 32 });
      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
    });

    it("stops at the vehicle limit and agrees with the engine's choice", async () => {
      // chargeLimit 100 so the schedule's 80% is the binding constraint rather
      // than the vehicle's own limit, which is checked earlier.
      ctx = await setupController(
        {
          batteryLevel: 85,
          chargeLimit: 100,
          isCharging: true,
          chargeAmps: 32,
        },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 0, gridPowerW: 3500 },
      );
      await addOverlappingPair(
        ctx,
        (await findCharger(ctx)).id,
        "vehicle-first",
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      assertExists(log);
      // The controller's requestState limit and the engine's decision both come
      // from the one selector, so the check reports the merged 80% limit.
      const scheduleCheck = log.checks.find((c) =>
        c.check === "charge_schedule"
      );
      expect(scheduleCheck?.result).toContain("limit reached (85% >= 80%)");
      expect(scheduleCheck?.result).toContain("@ 32A");
      expect(log.action).not.toBe("start");
    });
  });

  describe("schedule to solar transition", () => {
    it("stops immediately when no solar generation (nighttime)", async () => {
      // Was charging at 16A under a schedule that just ended; zero solar means
      // grace-period would burn grid for nothing — should stop now.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 16, chargePowerKw: 3.68 },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 0, gridPowerW: 3500 },
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("stop");
      expect(log?.actionDetail).toContain("no solar generation");
      expect(log?.actionDetail).toContain("no grace period");
    });

    it("drops to min amps during grace period when solar exists but is insufficient", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 16, chargePowerKw: 3.68 },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 500, gridPowerW: 3500 },
      );
      await ctx.runOneLoop();

      expect(ctx.adapter.commands).toContainEqual({
        cmd: "setAmps",
        args: 5,
      });
      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("adjust_amps");
      expect(log?.targetAmps).toBe(5);
    });

    it("enters grace period when solar is below min generation but non-zero", async () => {
      // 800W is below the 1kW min_solar_generation threshold but not zero —
      // should grace, not stop hard.
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10, chargePowerKw: 2.3 },
        "auto",
        {
          ...BASE_ENERGY,
          solarProductionW: 800,
          gridPowerW: 2000,
          homeConsumptionW: 2800,
        },
        { min_solar_generation_kw: "1", grace_period_minutes: "6" },
      );

      await ctx.runOneLoop();

      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("adjust_amps");
      expect(log?.actionDetail).toContain("grace");
      expect(log?.targetAmps).toBe(5);
    });

    it("enforces cooldown after grace expires due to low solar generation", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10, chargePowerKw: 2.3 },
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

      // Loop 1: enters grace period
      await ctx.runOneLoop();
      expect(ctx.adapter.commands).not.toContainEqual({ cmd: "stop" });

      // Loop 2: grace expires → stop with cooldown
      fakeTime.tick(90_000);
      await ctx.runOneLoop();
      const log1 = await ctx.getLastLogParsed();
      expect(log1?.action).toBe("stop");
      expect(log1?.actionDetail).toContain("grace period expired");

      // Solar recovers — enough to charge
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
        gridPowerW: -2000,
      };

      // Loop 3: 1 minute later — cooldown should prevent restart
      fakeTime.tick(60_000);
      await ctx.runOneLoop();
      const log2 = await ctx.getLastLogParsed();
      expect(log2?.action).toBe("none");
      expect(log2?.actionDetail).toContain("ooldown");

      // Loop 4: after cooldown expires — should restart
      ctx.adapter.commands = [];
      fakeTime.tick(15 * 60_000);
      await ctx.runOneLoop();
      const log3 = await ctx.getLastLogParsed();
      expect(log3?.action).toBe("start");
    });
  });
});
