import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  BASE_ENERGY,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";
import { MockEnergyPollerAdapter } from "../../test-helpers/MockEnergyPollerAdapter.ts";
import { EnergyPoller } from "../EnergyPoller.ts";
import { ChargeController } from "../ChargeController.ts";
import { ConfigService } from "../ConfigService.ts";
import { Logger } from "../../lib/Logger.ts";
import { testable } from "../../test-helpers/Testable.ts";

describe("ChargeController — failed energy data", () => {
  async function setup() {
    const ctx = await setupController({}, "auto", null, {
      min_solar_generation_kw: "0.1",
      solar_tracking_mode: "solar_only",
    });
    const energy = new MockEnergyPollerAdapter({
      ...BASE_ENERGY,
      gridPowerW: -3500,
    });
    const manager = energy.asManager();
    const log = new Logger("EnergyFailureIntegration", "error");
    const poller = new EnergyPoller(
      manager,
      ctx.chargingPointManager,
      ctx.trackingEmitter,
      ctx.db,
      log,
    );

    await poller.stop();

    const controller = new ChargeController(
      ctx.manager,
      ctx.chargingPointManager,
      poller,
      ctx.db,
      new ConfigService(ctx.db, manager, null, log),
      ctx.trackingEmitter,
      log,
    );
    controller.stop();
    return {
      ...ctx,
      energy,
      poller,
      controller,
      tick: async () => {
        await testable(poller).poll();
        await controller.runOnce();
      },
      close: async () => {
        controller.stop();
        await poller.stop();
        ctx.db.close();
      },
    };
  }

  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("stops solar charging on failed energy data and recovers on fresh data", async () => {
    await ctx.tick();

    expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });

    ctx.adapter.commands = [];
    ctx.energy.shouldFail = true;

    await ctx.tick();

    expect(ctx.poller.getRealtimeSnapshot().realtime).toMatchObject({
      pollFailed: true,
      solarProductionW: 0,
    });
    expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });

    ctx.adapter.commands = [];
    ctx.energy.shouldFail = false;

    await ctx.tick();

    expect(ctx.poller.getRealtimeSnapshot().realtime.pollFailed)
      .toBeUndefined();
    expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
  });

  it("does not start solar charging during an energy outage", async () => {
    ctx.energy.shouldFail = true;
    await ctx.tick();

    expect(ctx.adapter.commands).not.toContainEqual({ cmd: "start" });
    expect(ctx.poller.getRealtimeSnapshot().realtime.pollFailed).toBe(true);

    ctx.energy.shouldFail = false;

    await ctx.tick();

    expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
  });

  it("leaves explicit Charge Now independent of failed solar telemetry", async () => {
    await ctx.setMode("charge_now");
    ctx.energy.shouldFail = true;
    await ctx.tick();

    expect(ctx.poller.getRealtimeSnapshot().realtime.pollFailed).toBe(true);
    expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
  });
});
