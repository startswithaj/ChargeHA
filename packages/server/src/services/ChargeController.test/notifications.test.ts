import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  BASE_ENERGY,
  type ControllerCtx,
  currentScheduleWindow,
  REQUEST_CONTEXT,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — notifications", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("emitNotifications", () => {
    it("fires charge_started when controller starts charging", async () => {
      ctx = await setupController({}, "stop");
      await ctx.runOneLoop();
      expect(ctx.trackingEmitter.controllerEvents()).toHaveLength(0);

      await ctx.db.updateVehicleMode(VIN, "charge_now");
      await ctx.runOneLoop();

      const startEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_charge_started",
      );
      expect(startEvents).toHaveLength(1);
      expect((startEvents[0].data as { vehicleName: string }).vehicleName).toBe(
        "Test Car",
      );
    });

    it("fires charge_stopped when controller stops charging", async () => {
      ctx = await setupController({}, "charge_now");
      await ctx.runOneLoop();

      await ctx.db.updateVehicleMode(VIN, "stop");
      await ctx.runOneLoop();

      const stopEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_charge_stopped",
      );
      expect(stopEvents).toHaveLength(1);
      expect((stopEvents[0].data as { vehicleName: string }).vehicleName).toBe(
        "Test Car",
      );
    });

    it("fires charge_stopped with reason=battery_at_limit when battery reaches limit", async () => {
      ctx = await setupController(
        { isCharging: true, batteryLevel: 75, chargeLimit: 80 },
        "charge_now",
      );
      await ctx.runOneLoop();

      ctx.adapter.state.batteryLevel = 80;
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);

      await ctx.runOneLoop();

      const stoppedEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_charge_stopped",
      );
      expect(stoppedEvents).toHaveLength(1);
      const data = stoppedEvents[0].data as {
        reason: string;
        batteryLevel?: number;
        chargeLimit?: number;
      };
      expect(data.reason).toBe("battery_at_limit");
      expect(data.batteryLevel).toBe(80);
      expect(data.chargeLimit).toBe(80);
    });

    it("fires low_solar when grace period starts", async () => {
      // Solar above 0.2kW min generation but excess below min amps:
      // gridPowerW=2000 (importing) → available = -2000 + addback(2300) = 300W → 1A.
      ctx = await setupController(
        {
          isCharging: true,
          chargeAmps: 10,
          chargerVoltage: 230,
          chargePowerKw: 2.3,
        },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 500, gridPowerW: 2000 },
      );
      // First loop: init (low_solar suppressed during init path)
      await ctx.runOneLoop();
      // Second loop: grace still active, low_solar fires
      await ctx.runOneLoop();

      const lowSolarEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_low_solar",
      );
      expect(lowSolarEvents).toHaveLength(1);
    });

    it("fires schedule_activated when a new schedule becomes active", async () => {
      ctx = await setupController({}, "auto");
      await ctx.runOneLoop();

      const { today, startTime, endTime } = currentScheduleWindow();
      await ctx.db.createSchedule({
        id: "sched-notif-1",
        vehicleId: VIN,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });

      await ctx.runOneLoop();

      const schedEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_schedule_activated",
      );
      expect(schedEvents).toHaveLength(1);
      const schedData = schedEvents[0].data as {
        scheduleType: string;
        startTime: string;
      };
      expect(schedData.scheduleType).toBe("charge");
      expect(schedData.startTime).toBe(startTime);
    });

    it("fires schedule_activated for blockout schedules", async () => {
      ctx = await setupController({}, "auto");
      await ctx.runOneLoop();

      const { today, startTime, endTime } = currentScheduleWindow();
      await ctx.db.createSchedule({
        id: "blockout-notif-1",
        vehicleId: null,
        scheduleType: "blockout",
        startTime,
        endTime,
        days: [today],
        chargeAmps: null,
        chargeLimitPct: null,
        enabled: true,
      });

      await ctx.runOneLoop();

      const schedEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_schedule_activated",
      );
      expect(schedEvents).toHaveLength(1);
      expect((schedEvents[0].data as { scheduleType: string }).scheduleType)
        .toBe("blockout");
    });

    it("does not fire schedule_activated for already-active schedules", async () => {
      const { today, startTime, endTime } = currentScheduleWindow();

      ctx = await setupController({}, "auto");
      // Create schedule BEFORE first loop so init captures it as already active
      await ctx.db.createSchedule({
        id: "sched-already-active",
        vehicleId: VIN,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });

      await ctx.runOneLoop();
      await ctx.runOneLoop();

      const schedEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_schedule_activated",
      );
      expect(schedEvents).toHaveLength(0);
    });

    it("does not emit external_charge or charge_started when vehicle state is unavailable on first loop", async () => {
      ctx = await setupController({}, "auto", BASE_ENERGY, {}, {
        skipInitialState: true,
      });
      ctx.adapter.getChargeState = () =>
        Promise.reject(new Error("adapter offline"));

      // Loop 1: no vehicle state — controller must take the null-state path
      // without crashing and without misclassifying state for notifications.
      await ctx.runOneLoop();
      // Loop 2: still no vehicle state. An uninitialised engine would
      // mis-emit start/external on this tick.
      await ctx.runOneLoop();

      const events = ctx.trackingEmitter.controllerEvents();
      expect(
        events.filter((e) => e.type === "controller_external_charge"),
      ).toHaveLength(0);
      expect(
        events.filter((e) => e.type === "controller_charge_started"),
      ).toHaveLength(0);
    });

    it("fires schedule_activated for global charge schedule (vehicleId=null)", async () => {
      ctx = await setupController({}, "auto");
      await ctx.runOneLoop();

      const { today, startTime, endTime } = currentScheduleWindow();
      // Global charge schedule (vehicleId=null) covers the path where
      // scheduleType !== "blockout" and vehicleId === null both apply.
      await ctx.db.createSchedule({
        id: "global-charge-notif",
        vehicleId: null,
        scheduleType: "charge",
        startTime,
        endTime,
        days: [today],
        chargeAmps: 16,
        chargeLimitPct: null,
        enabled: true,
      });

      await ctx.runOneLoop();

      const schedEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_schedule_activated",
      );
      expect(schedEvents).toHaveLength(1);
      expect((schedEvents[0].data as { scheduleType: string }).scheduleType)
        .toBe("charge");
    });

    it("does not fire charge_stopped when vehicle stops but action was not stop", async () => {
      ctx = await setupController(
        { isCharging: true, chargeAmps: 10 },
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3000 },
      );
      await ctx.runOneLoop();

      // Vehicle stops on its own — not by our action
      ctx.adapter.state.isCharging = false;
      ctx.adapter.state.chargeAmps = 0;
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);

      await ctx.runOneLoop();

      const stopEvents = ctx.trackingEmitter.controllerEvents().filter(
        (e) => e.type === "controller_charge_stopped",
      );
      expect(stopEvents).toHaveLength(0);
    });
  });
});
