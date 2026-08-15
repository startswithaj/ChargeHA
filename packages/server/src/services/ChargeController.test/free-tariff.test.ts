import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  BASE_ENERGY,
  type ControllerCtx,
  currentScheduleWindow,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";
import type { AppDatabase } from "../../db/AppDatabase.ts";

describe("ChargeController — free tariff charging", () => {
  /** Night-time energy — no solar, importing. Solar tracking bows out here,
   *  so a charge can only have come from the free-tariff path. */
  const NIGHT = { ...BASE_ENERGY, solarProductionW: 0, gridPowerW: 2000 };
  const FREE_TARIFF_ON = { free_tariff_charging_enabled: "true" };

  /** Insert a tariff period at `ratePerKwh` that is active right now. */
  const seedActiveTariff = async (
    db: AppDatabase,
    ratePerKwh: number,
  ): Promise<void> => {
    const { today, startTime, endTime } = currentScheduleWindow();
    await db.createTariffPeriod({
      label: "Test",
      startTime,
      endTime,
      days: [today],
      ratePerKwh,
    });
  };

  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  it("starts a grid charge when the active tariff is free", async () => {
    ctx = await setupController({}, "auto", NIGHT, FREE_TARIFF_ON);
    await seedActiveTariff(ctx.db, 0);
    await ctx.runOneLoop();

    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("start");
    expect(log?.actionDetail).toContain("grid is free");
    expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
  });

  it("does not charge when the active tariff costs money", async () => {
    ctx = await setupController({}, "auto", NIGHT, FREE_TARIFF_ON);
    await seedActiveTariff(ctx.db, 0.32);
    await ctx.runOneLoop();

    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("none");
    expect(log?.checks).toContainEqual({
      check: "free_tariff",
      result: "not free (0.32 > 0/kWh)",
    });
  });

  it("does not charge when the feature is disabled", async () => {
    ctx = await setupController({}, "auto", NIGHT, {});
    await seedActiveTariff(ctx.db, 0);
    await ctx.runOneLoop();

    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("none");
    expect(log?.checks).toContainEqual({
      check: "free_tariff",
      result: "skip (disabled)",
    });
  });

  it("does not charge when no tariff periods are configured", async () => {
    ctx = await setupController({}, "auto", NIGHT, FREE_TARIFF_ON);
    await ctx.runOneLoop();

    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("none");
    expect(log?.checks).toContainEqual({
      check: "free_tariff",
      result: "skip (rate unknown)",
    });
  });

  it("holds while the home battery is below its priority limit", async () => {
    ctx = await setupController(
      {},
      "auto",
      { ...NIGHT, batterySoc: 40 },
      {
        ...FREE_TARIFF_ON,
        battery_priority_enabled: "true",
        battery_priority_limit: "80",
      },
    );
    await seedActiveTariff(ctx.db, 0);
    await ctx.runOneLoop();

    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("none");
    expect(log?.actionDetail).toContain("Waiting for home battery");
    expect(ctx.adapter.commands).not.toContainEqual({ cmd: "start" });
  });

  it("charges once the home battery is at its priority limit", async () => {
    ctx = await setupController(
      {},
      "auto",
      { ...NIGHT, batterySoc: 90 },
      {
        ...FREE_TARIFF_ON,
        battery_priority_enabled: "true",
        battery_priority_limit: "80",
      },
    );
    await seedActiveTariff(ctx.db, 0);
    await ctx.runOneLoop();

    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("start");
    expect(log?.actionDetail).toContain("grid is free");
  });

  it("charges through a cheap window when a threshold is set", async () => {
    ctx = await setupController({}, "auto", NIGHT, {
      ...FREE_TARIFF_ON,
      free_tariff_max_rate_per_kwh: "0.1",
    });
    await seedActiveTariff(ctx.db, 0.08);
    await ctx.runOneLoop();

    const log = await ctx.getLastLogParsed();
    expect(log?.action).toBe("start");
    expect(log?.actionDetail).toContain("grid rate is 0.08/kWh");
  });
});
