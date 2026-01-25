import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  type ControllerCtx,
  setupController,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — solar basics", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("mode: auto — solar tracking", () => {
    it("starts charging when excess solar is sufficient", async () => {
      ctx = await setupController(
        {},
        "auto",
        { ...BASE_ENERGY, gridPowerW: -3000 },
      );
      await ctx.runOneLoop();

      // -(-3000) = 3000W / 230V = 13A → clamped to 5-32
      expect(ctx.adapter.commands).toContainEqual({ cmd: "start" });
      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(log.action).toBe("start");
      expect(log.targetAmps).toBeGreaterThanOrEqual(5);
    });

    it("does not start when excess solar is below min amps", async () => {
      ctx = await setupController(
        {},
        "auto",
        { ...BASE_ENERGY, gridPowerW: -500 },
      );
      await ctx.runOneLoop();

      // -(-500) = 500W / 230V = 2A → below min 5A
      expect(ctx.adapter.commands).toEqual([]);
      const log = await ctx.getLastLogParsed();
      expect(log?.action).toBe("none");
    });

    it("does not start when solar is below min generation", async () => {
      ctx = await setupController(
        {},
        "auto",
        { ...BASE_ENERGY, solarProductionW: 100, gridPowerW: -50 },
      );
      await ctx.runOneLoop();

      // 100W = 0.1kW < default min 0.2kW
      expect(ctx.adapter.commands).toEqual([]);
      const log = await ctx.getLastLogParsed();
      assertExists(log);
      expect(
        log.checks.some(
          (c) =>
            c.check === "min_solar_generation" && c.result.includes("below"),
        ),
      ).toBe(true);
    });
  });

  describe("voltage resolution for solar tracking", () => {
    type VoltageCase = {
      label: string;
      chargerVoltage: number;
      gridPowerW: number;
      gridVoltageV: number | null;
      configGridVoltage?: string;
      expectedAction: "start" | "none";
      expectedTargetAmps: number | null;
    };
    // Cases cover: vehicle voltage preferred / junk vehicle voltage falls
    // through to inverter / config fallback when both missing / junk-voltage
    // clamp guard against the historic 548W/2V=274A bug.
    const cases: VoltageCase[] = [
      {
        label: "uses vehicle voltage when valid (>= 100V)",
        chargerVoltage: 240,
        gridPowerW: -2400,
        gridVoltageV: 230,
        expectedAction: "start",
        expectedTargetAmps: 10,
      },
      {
        label: "ignores junk vehicle voltage and uses inverter reading",
        chargerVoltage: 2,
        gridPowerW: -2300,
        gridVoltageV: 230,
        expectedAction: "start",
        expectedTargetAmps: 10,
      },
      {
        label:
          "falls back to config gridVoltage when vehicle and inverter unavailable",
        chargerVoltage: 0,
        gridPowerW: -2300,
        gridVoltageV: null,
        configGridVoltage: "230",
        expectedAction: "start",
        expectedTargetAmps: 10,
      },
      {
        label:
          "junk vehicle voltage does not cause wildly wrong amp calculation",
        chargerVoltage: 2,
        gridPowerW: -548,
        gridVoltageV: null,
        configGridVoltage: "230",
        expectedAction: "none",
        expectedTargetAmps: null,
      },
    ];

    cases.forEach((
      {
        label,
        chargerVoltage,
        gridPowerW,
        gridVoltageV,
        configGridVoltage,
        expectedAction,
        expectedTargetAmps,
      },
    ) => {
      it(label, async () => {
        ctx = await setupController(
          { chargerVoltage },
          "auto",
          { ...BASE_ENERGY, gridPowerW, gridVoltageV },
          configGridVoltage ? { grid_voltage: configGridVoltage } : {},
        );
        await ctx.runOneLoop();

        const log = await ctx.getLastLogParsed();
        assertExists(log);
        expect(log.action).toBe(expectedAction);
        expect(log.targetAmps).toBe(expectedTargetAmps);
      });
    });
  });

  describe("solar add-back uses chargeAmps, not stale chargePowerKw", () => {
    it("does not overshoot when chargePowerKw lags behind actual charge rate", async () => {
      // chargeAmps=10 but chargePowerKw is stale (from when it was at 7A).
      // Add-back uses chargeAmps × voltage (10 × 230 = 2300W), not chargePowerKw.
      // available = 200 + 2300 = 2500W → 10A (stable)
      ctx = await setupController(
        {
          isCharging: true,
          chargeAmps: 10,
          chargePowerKw: 1.61, // stale — doesn't affect add-back
          chargerVoltage: 230,
        },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 5000, gridPowerW: -200 },
      );

      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      // Should remain stable at 10A, not drop to 7A due to stale power data
      expect(log?.targetAmps).toBe(10);
      expect(log?.action).toBe("none");
    });
  });

  describe("consumption_excludes_charging (inverted logic)", () => {
    it("adds back charging power when setting is OFF (default)", async () => {
      // Vehicle is charging at 2kW, grid shows -34W export
      // Available = 34W without add-back (0A) vs 2034W with add-back (8A)
      ctx = await setupController(
        { isCharging: true, chargePowerKw: 2.0, chargeAmps: 8 },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 4000, gridPowerW: -34 },
        { consumption_excludes_charging: "false" },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      // Should NOT be in grace period — should see sufficient solar
      expect(log?.actionDetail).not.toContain("insufficient solar");
      expect(log?.actionDetail).not.toContain("Grace period");
    });

    it("does NOT add back charging power when setting is ON", async () => {
      // When meter excludes charger, the grid export already reflects true available
      // So 34W export → 0A, legitimately insufficient
      ctx = await setupController(
        { isCharging: true, chargePowerKw: 2.0, chargeAmps: 8 },
        "auto",
        { ...BASE_ENERGY, solarProductionW: 4000, gridPowerW: -34 },
        { consumption_excludes_charging: "true" },
      );
      await ctx.runOneLoop();

      const log = await ctx.getLastLogParsed();
      // Should see insufficient solar / grace period
      expect(
        log?.actionDetail.includes("insufficient solar") ||
          log?.actionDetail.includes("Grace period"),
      ).toBe(true);
    });
  });
});
