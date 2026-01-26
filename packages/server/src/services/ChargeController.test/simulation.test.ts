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

describe("ChargeController — full-day simulation", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("solar tracking — full day simulation", () => {
    // Manual Date.now override instead of FakeTime: FakeTime intercepts
    // setTimeout/setInterval, which collides with the controller and poller
    // timers and leaks them between tests.
    let fakeNow: number | null = null;
    const realDateNow = Date.now;

    afterEach(() => {
      Date.now = realDateNow;
      fakeNow = null;
    });

    const enableFakeTime = (): void => {
      fakeNow = realDateNow.call(Date);
      Date.now = () => {
        assertExists(fakeNow);
        return fakeNow;
      };
    };

    async function tick(
      solarW: number,
      gridW: number,
      homeW?: number,
    ): Promise<{ action: string; detail: string; targetAmps: number | null }> {
      assertExists(ctx);
      if (fakeNow !== null) fakeNow += 60_000;
      ctx.poller.snapshot = {
        realtime: {
          ...BASE_ENERGY,
          solarProductionW: solarW,
          gridPowerW: gridW,
          homeConsumptionW: homeW ?? BASE_ENERGY.homeConsumptionW,
        },
        cumulative: {
          solarProducedWh: 0,
          gridImportedWh: 0,
          gridExportedWh: 0,
          dailySolarProducedWh: 0,
          dailyGridImportWh: 0,
          dailyGridExportWh: 0,
        },
      };
      // Reflect the controller's last command back into the simulated car so
      // the next requestState sees the new chargeAmps/isCharging.
      const cachedState = await ctx.manager.getState(VIN);
      if (cachedState) {
        ctx.adapter.state = { ...cachedState };
      }
      await ctx.manager.requestState(VIN, REQUEST_CONTEXT);
      await ctx.runOneLoop();
      const log = await ctx.getLastLogParsed();
      return {
        action: log?.action ?? "unknown",
        detail: log?.actionDetail ?? "",
        targetAmps: log?.targetAmps ?? null,
      };
    }

    it("tracks solar through a full day: dawn → clouds → storm → recovery → dusk", async () => {
      ctx = await setupController(
        { isCharging: false, chargeAmps: 0 },
        "auto",
        BASE_ENERGY,
        {
          solar_tracking_enabled: "true",
          min_solar_generation_kw: "1",
          grace_period_minutes: "6",
          cooldown_period_minutes: "5",
        },
      );

      enableFakeTime();

      // == Dawn: solar ramping up ==

      // 800W solar — below 1kW min generation
      let r = await tick(800, 200);
      expect(r.action).toBe("none");

      // 1200W solar but only 200W excess — below min amps
      r = await tick(1200, -200);
      expect(r.action).toBe("none");

      // 3000W solar, 1500W export → 6A at 230V
      r = await tick(3000, -1500);
      expect(r.action).toBe("start");
      expect(r.targetAmps).toBeGreaterThanOrEqual(5);

      // == Morning: good solar, ramping up ==

      r = await tick(5000, -3000);
      expect(r.action).not.toBe("stop");

      r = await tick(7000, -4500);
      expect(r.action).not.toBe("stop");

      // == Cloud passes: brief dip ==

      // Solar drops to 2000W, still exporting a little — ramp down, not stop
      r = await tick(2000, -500);
      expect(r.action).not.toBe("stop");

      r = await tick(6000, -4000);
      expect(r.action).not.toBe("stop");

      // == Heavy storm: sustained insufficient solar ==
      //
      // Add-back formula: available = -gridW + chargeAmps × 230.
      // At up to 32A: need gridW > 6210 for insufficient. gridW=7000 is safe.
      // Once grace drops car to 5A: add-back = 1150W, so gridW > 1150 stays
      // insufficient. Using gridW=2000 for all subsequent storm ticks.
      //
      // Grace = 6 min = 6 ticks. Timing from first insufficient tick:
      //   tick 0: grace starts (0s/360s) — adjust to min amps
      //   ticks 1–5: grace active (60s–300s)
      //   tick 6: grace expired (≥360s) — stop + cooldown

      // Tick 0: solar crashes, grace starts, car drops to min amps
      r = await tick(800, 7000);
      expect(r.action).toBe("adjust_amps");
      expect(r.targetAmps).toBe(5);

      // Ticks 1–5: grace active, car stays at min amps
      r = await tick(500, 2000);
      expect(r.action).toBe("none");
      r = await tick(400, 2000);
      expect(r.action).toBe("none");
      r = await tick(400, 2000);
      expect(r.action).toBe("none");
      r = await tick(400, 2000);
      expect(r.action).toBe("none");
      r = await tick(400, 2000);
      expect(r.action).toBe("none");

      // Tick 6: grace expires — stop with cooldown
      r = await tick(400, 2000);
      expect(r.action).toBe("stop");

      // == Storm continues: car stopped, solar still low ==
      r = await tick(500, 1500);
      expect(r.action).toBe("none");

      // == Recovery: solar returns ==
      //
      // Cooldown = 5 min = 5 ticks from the stop.
      // Ticks 1–3: cooldown active. Tick 4: cooldown expires → restart.

      r = await tick(4000, -2500);
      expect(r.action).toBe("none");
      r = await tick(4000, -2500);
      expect(r.action).toBe("none");
      r = await tick(4000, -2500);
      expect(r.action).toBe("none");

      r = await tick(4000, -2500);
      expect(r.action).toBe("start");
      expect(r.targetAmps).toBeGreaterThanOrEqual(5);

      // == Afternoon: strong solar ==
      r = await tick(8000, -6000);
      expect(r.action).not.toBe("stop");

      // == Dusk: solar fading ==
      // Same shape as storm: high grid to exceed add-back, then sustain
      // insufficient solar until grace expires.

      r = await tick(700, 7000);
      expect(r.action).toBe("adjust_amps");
      expect(r.targetAmps).toBe(5);

      r = await tick(500, 2000);
      expect(r.action).toBe("none");
      r = await tick(500, 2000);
      expect(r.action).toBe("none");
      r = await tick(500, 2000);
      expect(r.action).toBe("none");
      r = await tick(500, 2000);
      expect(r.action).toBe("none");
      r = await tick(500, 2000);
      expect(r.action).toBe("none");

      r = await tick(500, 2000);
      expect(r.action).toBe("stop");
    });

    it("does not thrash at the start threshold", async () => {
      ctx = await setupController(
        { isCharging: false, chargeAmps: 0 },
        "auto",
        BASE_ENERGY,
        {
          solar_tracking_enabled: "true",
          min_solar_generation_kw: "1",
          grace_period_minutes: "6",
          cooldown_period_minutes: "5",
        },
      );

      const solarValues = [
        { solarW: 3000, gridW: -1500 },
        { solarW: 2000, gridW: -500 },
        { solarW: 3200, gridW: -1700 },
        { solarW: 1800, gridW: -300 },
        { solarW: 3500, gridW: -2000 },
        { solarW: 1900, gridW: -400 },
      ];

      const results = await solarValues.reduce<Promise<string[]>>(
        async (prev, { solarW, gridW }) => {
          const acc = await prev;
          const r = await tick(solarW, gridW);
          return [...acc, r.action];
        },
        Promise.resolve([]),
      );

      const starts = results.filter((a) => a === "start").length;
      const stops = results.filter((a) => a === "stop").length;
      expect(starts).toBe(1);
      expect(stops).toBe(0);
    });
  });
});
