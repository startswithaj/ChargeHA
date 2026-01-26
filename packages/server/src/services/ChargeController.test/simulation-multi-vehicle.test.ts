import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import {
  BASE_ENERGY,
  type ControllerCtx,
  type MultiControllerCtx,
  setupController,
  setupMultiVehicleController,
} from "../../test-helpers/ChargeControllerHarness.ts";

describe("ChargeController — multi-vehicle", () => {
  const VIN_A = "VIN_PRIORITY_1";
  const VIN_B = "VIN_PRIORITY_2";
  const VIN_C = "VIN_PRIORITY_3";

  let ctx: MultiControllerCtx | undefined;
  let singleCtx: ControllerCtx | undefined;

  afterEach(() => {
    ctx?.controller.stop();
    ctx?.db.close();
    singleCtx?.controller.stop();
    singleCtx?.db.close();
    ctx = undefined;
    singleCtx = undefined;
  });

  describe("multi-vehicle solar allocation", () => {
    it("does not give both vehicles the full solar budget independently", async () => {
      // 2300W export → 10A. Two vehicles must NOT each get 10A.
      ctx = await setupMultiVehicleController(
        [
          { vin: VIN_A, name: "Car A", priority: 1 },
          { vin: VIN_B, name: "Car B", priority: 2 },
        ],
        { ...BASE_ENERGY, solarProductionW: 5000, gridPowerW: -2300 },
      );
      await ctx.runOneLoop();

      const logA = await ctx.getLogForVehicle(VIN_A);
      const logB = await ctx.getLogForVehicle(VIN_B);

      const totalTargetAmps = (logA?.targetAmps ?? 0) + (logB?.targetAmps ?? 0);
      expect(totalTargetAmps).toBeLessThanOrEqual(10);
    });

    it("splits solar equally between two eligible vehicles", async () => {
      // 3680W export → 16A. Split 8A each (hysteresis needs ≥ minAmps+2 per VIN).
      ctx = await setupMultiVehicleController(
        [
          { vin: VIN_A, name: "Car A", priority: 1 },
          { vin: VIN_B, name: "Car B", priority: 2 },
        ],
        { ...BASE_ENERGY, solarProductionW: 6680, gridPowerW: -3680 },
      );
      await ctx.runOneLoop();

      const logA = await ctx.getLogForVehicle(VIN_A);
      const logB = await ctx.getLogForVehicle(VIN_B);

      expect(logA?.targetAmps).toBe(8);
      expect(logB?.targetAmps).toBe(8);
    });

    it("gives remainder amp to highest-priority vehicle", async () => {
      // 3910W export → 17A. floor(17/2)=8, remainder 1 to priority 1.
      ctx = await setupMultiVehicleController(
        [
          { vin: VIN_A, name: "Car A", priority: 1 },
          { vin: VIN_B, name: "Car B", priority: 2 },
        ],
        { ...BASE_ENERGY, solarProductionW: 6910, gridPowerW: -3910 },
      );
      await ctx.runOneLoop();

      const logA = await ctx.getLogForVehicle(VIN_A);
      const logB = await ctx.getLogForVehicle(VIN_B);

      expect(logA?.targetAmps).toBe(9);
      expect(logB?.targetAmps).toBe(8);
    });

    it("charges only highest-priority vehicle when solar is insufficient for two", async () => {
      // 1380W export → 6A. Enough for one at min 5A, not two (would need 10A).
      ctx = await setupMultiVehicleController(
        [
          { vin: VIN_A, name: "Car A", priority: 1 },
          { vin: VIN_B, name: "Car B", priority: 2 },
        ],
        { ...BASE_ENERGY, solarProductionW: 4380, gridPowerW: -1380 },
      );
      await ctx.runOneLoop();

      const logA = await ctx.getLogForVehicle(VIN_A);
      const logB = await ctx.getLogForVehicle(VIN_B);

      expect(logA?.action).toBe("start");
      expect(logA?.targetAmps).toBe(6);
      expect(logB?.action).toBe("none");
      expect(logB?.targetAmps).toBeNull();
    });

    it("adds back ALL vehicles' consumption when calculating available solar", async () => {
      // Both at 8A (1840W each). Grid -200W. True available = 200 + 3680 = 3880W → 16A.
      // Split 8A each, stable. Bug would be: each VIN only adds back its own draw.
      ctx = await setupMultiVehicleController(
        [
          {
            vin: VIN_A,
            name: "Car A",
            priority: 1,
            state: { isCharging: true, chargeAmps: 8, chargerVoltage: 230 },
          },
          {
            vin: VIN_B,
            name: "Car B",
            priority: 2,
            state: { isCharging: true, chargeAmps: 8, chargerVoltage: 230 },
          },
        ],
        { ...BASE_ENERGY, solarProductionW: 5000, gridPowerW: -200 },
      );
      await ctx.runOneLoop();

      const logA = await ctx.getLogForVehicle(VIN_A);
      const logB = await ctx.getLogForVehicle(VIN_B);

      const totalTargetAmps = (logA?.targetAmps ?? 0) + (logB?.targetAmps ?? 0);
      expect(totalTargetAmps).toBeLessThanOrEqual(16);
      expect(logA?.actionDetail).not.toContain("insufficient solar");
      expect(logB?.actionDetail).not.toContain("insufficient solar");
    });

    it("does not cause both vehicles to cycle on and off together", async () => {
      // Solar=2500, home=1500, both at 7A (3220W EV load). gridPowerW=1840 (importing).
      // True available = -1840 + 3220 = 1380W → 6A. Enough for one only.
      ctx = await setupMultiVehicleController(
        [
          {
            vin: VIN_A,
            name: "Car A",
            priority: 1,
            state: { isCharging: true, chargeAmps: 7, chargerVoltage: 230 },
          },
          {
            vin: VIN_B,
            name: "Car B",
            priority: 2,
            state: { isCharging: true, chargeAmps: 7, chargerVoltage: 230 },
          },
        ],
        {
          ...BASE_ENERGY,
          solarProductionW: 2500,
          gridPowerW: 1840,
          homeConsumptionW: 1500,
        },
      );
      await ctx.runOneLoop();

      const logA = await ctx.getLogForVehicle(VIN_A);
      const logB = await ctx.getLogForVehicle(VIN_B);

      expect(logA?.actionDetail).not.toContain("insufficient solar");
      expect(logA?.actionDetail).not.toContain("Grace period");
      expect(logA?.targetAmps).toBeGreaterThanOrEqual(5);
      expect(logB?.actionDetail).toContain("insufficient solar");
    });

    it("excluded vehicle stops after grace period expires", async () => {
      ctx = await setupMultiVehicleController(
        [
          {
            vin: VIN_A,
            name: "Car A",
            priority: 1,
            state: { isCharging: true, chargeAmps: 7, chargerVoltage: 230 },
          },
          {
            vin: VIN_B,
            name: "Car B",
            priority: 2,
            state: { isCharging: true, chargeAmps: 7, chargerVoltage: 230 },
          },
        ],
        {
          ...BASE_ENERGY,
          solarProductionW: 2500,
          gridPowerW: 1840,
          homeConsumptionW: 1500,
        },
        { grace_period_minutes: "1" },
      );

      using fakeTime = new FakeTime();

      await ctx.runOneLoop();
      const log1 = await ctx.getLogForVehicle(VIN_B);
      expect(log1?.actionDetail).toContain("grace");

      fakeTime.tick(90_000);
      await ctx.runOneLoop();

      const log2 = await ctx.getLogForVehicle(VIN_B);
      expect(log2?.action).toBe("stop");
    });

    it("only highest-priority vehicle charges when solar barely covers one at min amps", async () => {
      // 1150W export = 5A exactly — only one at min amps fits.
      ctx = await setupMultiVehicleController(
        [
          { vin: VIN_A, name: "Car A", priority: 1 },
          { vin: VIN_B, name: "Car B", priority: 2 },
        ],
        { ...BASE_ENERGY, solarProductionW: 4150, gridPowerW: -1150 },
      );
      await ctx.runOneLoop();

      const logA = await ctx.getLogForVehicle(VIN_A);
      const logB = await ctx.getLogForVehicle(VIN_B);

      expect(logA?.action).toBe("start");
      expect(logA?.targetAmps).toBe(5);
      expect(logB?.action).toBe("none");
    });

    it("skips ineligible priority 1 vehicle and gives solar to priority 2", async () => {
      ctx = await setupMultiVehicleController(
        [
          {
            vin: VIN_A,
            name: "Car A",
            priority: 1,
            state: { isPluggedIn: false },
          },
          { vin: VIN_B, name: "Car B", priority: 2 },
        ],
        { ...BASE_ENERGY, solarProductionW: 5000, gridPowerW: -2300 },
      );
      await ctx.runOneLoop();

      const logA = await ctx.getLogForVehicle(VIN_A);
      const logB = await ctx.getLogForVehicle(VIN_B);

      expect(logA?.actionDetail).toContain("Not plugged in");
      expect(logB?.action).toBe("start");
      expect(logB?.targetAmps).toBe(10);
    });

    it("single vehicle behavior is unchanged by allocation logic", async () => {
      singleCtx = await setupController(
        {},
        "auto",
        { ...BASE_ENERGY, gridPowerW: -2300 },
      );
      await singleCtx.runOneLoop();

      const log = await singleCtx.getLastLogParsed();
      expect(log?.action).toBe("start");
      expect(log?.targetAmps).toBe(10);
    });

    describe("priority charging (waterfall mode)", () => {
      const PRIORITY_CONFIG = { priority_charging_enabled: "true" };

      it("respects priority order regardless of DB insertion order", async () => {
        // Insert priority 2 BEFORE priority 1 in DB — allocation must follow
        // the `priority` field, not insertion order.
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_B, name: "Car B", priority: 2 },
            { vin: VIN_A, name: "Car A", priority: 1 },
          ],
          { ...BASE_ENERGY, solarProductionW: 6450, gridPowerW: -3450 },
          PRIORITY_CONFIG,
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);

        expect(logA?.action).toBe("start");
        expect(logA?.targetAmps).toBe(15);
        expect(logB?.action).toBe("none");
      });

      it("gives all solar to priority 1 vehicle", async () => {
        // 3450W → 15A. P1 gets 15A, P2 gets nothing.
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_A, name: "Car A", priority: 1 },
            { vin: VIN_B, name: "Car B", priority: 2 },
          ],
          { ...BASE_ENERGY, solarProductionW: 6450, gridPowerW: -3450 },
          PRIORITY_CONFIG,
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);

        expect(logA?.action).toBe("start");
        expect(logA?.targetAmps).toBe(15);
        expect(logB?.action).toBe("none");
      });

      it("overflows to priority 2 when priority 1 is at max amps", async () => {
        // 9200W → 40A. P1 max=32A, remainder 8A → P2 gets 8A.
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_A, name: "Car A", priority: 1 },
            { vin: VIN_B, name: "Car B", priority: 2 },
          ],
          { ...BASE_ENERGY, solarProductionW: 12200, gridPowerW: -9200 },
          PRIORITY_CONFIG,
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);

        expect(logA?.action).toBe("start");
        expect(logA?.targetAmps).toBe(32);
        expect(logB?.action).toBe("start");
        expect(logB?.targetAmps).toBe(8);
      });

      it("skips ineligible priority 1 and gives all to priority 2", async () => {
        ctx = await setupMultiVehicleController(
          [
            {
              vin: VIN_A,
              name: "Car A",
              priority: 1,
              state: { isPluggedIn: false },
            },
            { vin: VIN_B, name: "Car B", priority: 2 },
          ],
          { ...BASE_ENERGY, solarProductionW: 6450, gridPowerW: -3450 },
          PRIORITY_CONFIG,
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);

        expect(logA?.actionDetail).toContain("Not plugged in");
        expect(logB?.action).toBe("start");
        expect(logB?.targetAmps).toBe(15);
      });

      it("skips priority 1 at charge limit and gives all to priority 2", async () => {
        ctx = await setupMultiVehicleController(
          [
            {
              vin: VIN_A,
              name: "Car A",
              priority: 1,
              state: { batteryLevel: 80, chargeLimit: 80 },
            },
            { vin: VIN_B, name: "Car B", priority: 2 },
          ],
          { ...BASE_ENERGY, solarProductionW: 6450, gridPowerW: -3450 },
          PRIORITY_CONFIG,
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);

        expect(logA?.actionDetail).toContain("at limit");
        expect(logB?.action).toBe("start");
        expect(logB?.targetAmps).toBe(15);
      });

      it("does not allocate overflow below priority 2 min amps", async () => {
        // P1 = 32A, remaining 3A < P2 min 5A → P2 stays off.
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_A, name: "Car A", priority: 1 },
            { vin: VIN_B, name: "Car B", priority: 2 },
          ],
          { ...BASE_ENERGY, solarProductionW: 11050, gridPowerW: -8050 },
          PRIORITY_CONFIG,
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);

        expect(logA?.targetAmps).toBe(32);
        expect(logB?.action).toBe("none");
        expect(logB?.actionDetail).toContain("insufficient solar");
      });

      it("uses equal split when priority charging is disabled", async () => {
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_A, name: "Car A", priority: 1 },
            { vin: VIN_B, name: "Car B", priority: 2 },
          ],
          { ...BASE_ENERGY, solarProductionW: 6450, gridPowerW: -3450 },
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);

        expect(logA?.targetAmps).toBe(8);
        expect(logB?.targetAmps).toBe(7);
      });
    });

    describe("three vehicles", () => {
      it("splits solar equally across three vehicles", async () => {
        // 4830W → 21A. 7A each.
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_A, name: "Car A", priority: 1 },
            { vin: VIN_B, name: "Car B", priority: 2 },
            { vin: VIN_C, name: "Car C", priority: 3 },
          ],
          { ...BASE_ENERGY, solarProductionW: 7830, gridPowerW: -4830 },
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);
        const logC = await ctx.getLogForVehicle(VIN_C);

        expect(logA?.targetAmps).toBe(7);
        expect(logB?.targetAmps).toBe(7);
        expect(logC?.targetAmps).toBe(7);
      });

      it("gives remainder amps to highest-priority vehicles", async () => {
        // 5290W → 23A. floor(23/3)=7 rem 2 → P1=8, P2=8, P3=7.
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_A, name: "Car A", priority: 1 },
            { vin: VIN_B, name: "Car B", priority: 2 },
            { vin: VIN_C, name: "Car C", priority: 3 },
          ],
          { ...BASE_ENERGY, solarProductionW: 8290, gridPowerW: -5290 },
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);
        const logC = await ctx.getLogForVehicle(VIN_C);

        expect(logA?.targetAmps).toBe(8);
        expect(logB?.targetAmps).toBe(8);
        expect(logC?.targetAmps).toBe(7);
      });

      it("drops lowest-priority vehicle when solar only covers two", async () => {
        // 3220W → 14A. floor(14/3)=4 < min+2 (7) → can't split 3 ways.
        // floor(14/2)=7 ≥ 7 → P1+P2 each get 7A, P3 stays off.
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_A, name: "Car A", priority: 1 },
            { vin: VIN_B, name: "Car B", priority: 2 },
            { vin: VIN_C, name: "Car C", priority: 3 },
          ],
          { ...BASE_ENERGY, solarProductionW: 6220, gridPowerW: -3220 },
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);
        const logC = await ctx.getLogForVehicle(VIN_C);

        expect(logA?.action).toBe("start");
        expect(logA?.targetAmps).toBe(7);
        expect(logB?.action).toBe("start");
        expect(logB?.targetAmps).toBe(7);
        expect(logC?.action).toBe("none");
      });

      it("charges only priority 1 when solar covers just one vehicle", async () => {
        // 1380W → 6A. Splits don't fit; only P1 gets 6A.
        ctx = await setupMultiVehicleController(
          [
            { vin: VIN_A, name: "Car A", priority: 1 },
            { vin: VIN_B, name: "Car B", priority: 2 },
            { vin: VIN_C, name: "Car C", priority: 3 },
          ],
          { ...BASE_ENERGY, solarProductionW: 4380, gridPowerW: -1380 },
        );
        await ctx.runOneLoop();

        const logA = await ctx.getLogForVehicle(VIN_A);
        const logB = await ctx.getLogForVehicle(VIN_B);
        const logC = await ctx.getLogForVehicle(VIN_C);

        expect(logA?.action).toBe("start");
        expect(logA?.targetAmps).toBe(6);
        expect(logB?.action).toBe("none");
        expect(logC?.action).toBe("none");
      });
    });
  });
});
