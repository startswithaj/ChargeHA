import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  BASE_ENERGY,
  type ControllerCtx,
  setupController,
  VIN,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — grace + command rejection", () => {
  let ctx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
  });

  describe("insufficient solar grace period does not cause amp oscillation", () => {
    it("ensureChargingAt updates cached chargeAmps so next cycle add-back is correct", async () => {
      // The oscillation bug: if the cached chargeAmps stays at 16 after
      // grace drops to 5A, the next cycle's add-back overestimates solar:
      //   available = -470 + 16*230 = 3210W → 13A (ramps up, wrong!)
      // With the fix, ensureChargingAt updates cached state to 5A:
      //   available = -470 + 5*230 = 680W → 2A (stays in grace, correct)

      // Setup: car at 16A, insufficient solar (3kW solar, 3kW grid import)
      ctx = await setupController(
        {
          isCharging: true,
          chargeAmps: 16,
          chargePowerKw: 3.68,
          chargerVoltage: 230,
        },
        "auto",
        {
          ...BASE_ENERGY,
          solarProductionW: 3000,
          gridPowerW: 3000,
          homeConsumptionW: 6000,
        },
        { min_solar_generation_kw: "1" },
      );

      // Loop 1: init cycle — processes vehicle, detects insufficient solar,
      // enters grace period, calls ensureChargingAt(5).
      await ctx.runOneLoop();

      // Key assertion: ensureChargingAt must have updated the poller's
      // cached state. If updateState doesn't update latestState, this
      // would still be 16 and the oscillation bug would occur.
      expect((await ctx.manager.getState(VIN))?.chargeAmps).toBe(5);

      // Now simulate energy reading after the car dropped to 5A.
      // Car at 5A ≈ 1150W. Home without car ≈ 2320W. Grid imports 470W.
      assertExists(ctx.poller.snapshot);
      ctx.poller.snapshot.realtime = {
        ...BASE_ENERGY,
        solarProductionW: 3000,
        gridPowerW: 470,
        homeConsumptionW: 3470,
      };
      ctx.adapter.commands = [];

      // Loop 2: with chargeAmps=5, add-back = 5*230 = 1150W.
      // available = -470 + 1150 = 680W → 2A < min 5A → stays in grace.
      // If chargeAmps were still 16, add-back = 16*230 = 3680W,
      // available = -470 + 3680 = 3210W → 13A → would ramp up (bug).
      await ctx.runOneLoop();
      const log = await ctx.getLastLogParsed();

      expect(log?.actionDetail).toContain("Grace period");
      expect(log?.actionDetail).not.toContain("Start charging");
      const highAmpCommands = ctx.adapter.commands.filter((c) =>
        c.cmd === "setAmps" && (c.args as number) > 5
      );
      expect(highAmpCommands).toHaveLength(0);
    });
  });

  describe("command rejection handling", () => {
    type RejectField =
      | "setChargeAmpsResult"
      | "startChargingResult"
      | "stopChargingResult";
    type RejectionCase = {
      label: string;
      vehicleState: Parameters<typeof setupController>[0];
      mode: Parameters<typeof setupController>[1];
      rejectField: RejectField;
    };
    const cases: RejectionCase[] = [
      {
        label: "setChargeAmps",
        vehicleState: { isCharging: true, chargeAmps: 5 },
        mode: "charge_now",
        rejectField: "setChargeAmpsResult",
      },
      {
        label: "startCharging",
        vehicleState: {},
        mode: "charge_now",
        rejectField: "startChargingResult",
      },
      {
        label: "stopCharging",
        vehicleState: { isCharging: true },
        mode: "stop",
        rejectField: "stopChargingResult",
      },
    ];

    cases.forEach(({ label, vehicleState, mode, rejectField }) => {
      it(`triggers backoff when ${label} returns false`, async () => {
        ctx = await setupController(vehicleState, mode);
        ctx.adapter[rejectField] = false;
        await ctx.runOneLoop();

        expect(ctx.manager.isBackedOff(VIN).backedOff).toBe(true);
      });
    });
  });
});
