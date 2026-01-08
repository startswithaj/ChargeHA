import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../AppDatabase.ts";
import type {
  VehicleChargeReadingInput,
  VehiclePollLogInput,
} from "../types.ts";

describe("AppDatabase", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
  });

  afterEach(() => {
    db.close();
  });

  describe("paginated queries", () => {
    it("getEnergyReadingsPaginated returns rows and total", async () => {
      await Array.from({ length: 5 }).reduce(async (prev, _, i) => {
        await prev;
        await db.insertEnergyReading({
          solarProductionW: i * 1000,
          gridPowerW: 0,
          homeConsumptionW: 0,
          batteryPowerW: null,
          batterySoc: null,
          gridVoltageV: null,
          lastUpdated: "2024-01-01T00:00:00.000Z",
        });
      }, Promise.resolve());

      const page = await db.energy.getEnergyReadingsPaginated({
        limit: 2,
        offset: 0,
      });
      expect(page.total).toBe(5);
      expect(page.rows).toHaveLength(2);
      expect(page.rows[0].timestamp).toBeDefined();
      expect(typeof page.rows[0].solarProductionW).toBe("number");
    });

    it("getEnergyReadingsPaginated respects offset", async () => {
      await Array.from({ length: 5 }).reduce(async (prev, _, i) => {
        await prev;
        await db.insertEnergyReading({
          solarProductionW: i * 1000,
          gridPowerW: 0,
          homeConsumptionW: 0,
          batteryPowerW: null,
          batterySoc: null,
          gridVoltageV: null,
          lastUpdated: "2024-01-01T00:00:00.000Z",
        });
      }, Promise.resolve());

      const page = await db.energy.getEnergyReadingsPaginated({
        limit: 10,
        offset: 3,
      });
      expect(page.rows).toHaveLength(2);
      expect(page.total).toBe(5);
    });

    it("getEnergyReadingsPaginated filters by from date", async () => {
      await db.insertEnergyReading({
        solarProductionW: 5000,
        gridPowerW: 0,
        homeConsumptionW: 0,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });

      const { total } = await db.energy.getEnergyReadingsPaginated({
        limit: 10,
        offset: 0,
        from: "2099-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.energy.getEnergyReadingsPaginated({
        limit: 10,
        offset: 0,
        from: "2000-01-01T00:00:00",
      });
      expect(total2).toBe(1);
    });

    it("getEnergyReadingsPaginated filters by to date", async () => {
      await db.insertEnergyReading({
        solarProductionW: 5000,
        gridPowerW: 0,
        homeConsumptionW: 0,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });

      const { total } = await db.energy.getEnergyReadingsPaginated({
        limit: 10,
        offset: 0,
        to: "2000-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.energy.getEnergyReadingsPaginated({
        limit: 10,
        offset: 0,
        to: "2099-01-01T00:00:00",
      });
      expect(total2).toBe(1);
    });

    it("getEnergyReadingsPaginated filters by combined from and to", async () => {
      await db.insertEnergyReading({
        solarProductionW: 5000,
        gridPowerW: 0,
        homeConsumptionW: 0,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });

      const { total } = await db.energy.getEnergyReadingsPaginated({
        limit: 10,
        offset: 0,
        from: "2000-01-01T00:00:00",
        to: "2099-01-01T00:00:00",
      });
      expect(total).toBe(1);

      const { total: total2 } = await db.energy.getEnergyReadingsPaginated({
        limit: 10,
        offset: 0,
        from: "2099-01-01T00:00:00",
        to: "2099-12-31T00:00:00",
      });
      expect(total2).toBe(0);
    });

    it(
      "getEnergyReadingsPaginated filters correctly across same-day ISO bounds",
      async () => {
        // Regression test for a lexicographic-comparison bug: SQLite stores
        // timestamps as "YYYY-MM-DD HH:MM:SS" while the client sends ISO bounds
        // "YYYY-MM-DDTHH:MM:SS.sssZ". Text comparison of ' ' < 'T' made same-day
        // boundaries return wrong results.
        const { energyReadings } = await import("../Schema.ts");
        await db.db.insert(energyReadings).values([
          {
            timestamp: "2026-04-07 23:59:37",
            solarProductionW: 5000,
            gridPowerW: 0,
            homeConsumptionW: 5000,
            batteryPowerW: null,
            batterySoc: null,
            ratePerKwh: null,
          },
          {
            timestamp: "2026-04-07 10:00:00",
            solarProductionW: 4000,
            gridPowerW: 0,
            homeConsumptionW: 4000,
            batteryPowerW: null,
            batterySoc: null,
            ratePerKwh: null,
          },
        ]);

        // to-bound earlier in the same day than the 23:59 row: must EXCLUDE it.
        const { total: toTotal } = await db.energy
          .getEnergyReadingsPaginated({
            limit: 10,
            offset: 0,
            to: "2026-04-07T15:37:00.000Z",
          });
        expect(toTotal).toBe(1);

        // from-bound later in the same day than the 10:00 row: must EXCLUDE it.
        const { total: fromTotal } = await db.energy
          .getEnergyReadingsPaginated({
            limit: 10,
            offset: 0,
            from: "2026-04-07T15:37:00.000Z",
          });
        expect(fromTotal).toBe(1);
      },
    );

    it("getVehicleChargeReadingsPaginated filters by vehicleId", async () => {
      const base: VehicleChargeReadingInput = {
        vehicleId: "VIN1",
        chargePowerW: 7000,
        chargeAmps: 32,
        batteryLevel: 65,
        solarContributionW: 5000,
        gridContributionW: 2000,
        isHome: true,
      };

      await db.insertVehicleChargeReading(base);
      await db.insertVehicleChargeReading({
        ...base,
        vehicleId: "VIN2",
      });
      await db.insertVehicleChargeReading(base);

      const { rows, total } = await db.vehicles
        .getVehicleChargeReadingsPaginated({
          limit: 10,
          offset: 0,
          vehicleId: "VIN1",
        });
      expect(total).toBe(2);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.vehicleId === "VIN1")).toBe(true);
    });

    it("getVehicleChargeReadingsPaginated filters by from date", async () => {
      await db.insertVehicleChargeReading({
        vehicleId: "VIN1",
        chargePowerW: 7000,
        chargeAmps: 32,
        batteryLevel: 65,
        solarContributionW: 5000,
        gridContributionW: 2000,
        isHome: true,
      });

      const { total } = await db.vehicles.getVehicleChargeReadingsPaginated({
        limit: 10,
        offset: 0,
        from: "2099-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.vehicles
        .getVehicleChargeReadingsPaginated({
          limit: 10,
          offset: 0,
          from: "2000-01-01T00:00:00",
        });
      expect(total2).toBe(1);
    });

    it("getVehicleChargeReadingsPaginated filters by to date", async () => {
      await db.insertVehicleChargeReading({
        vehicleId: "VIN1",
        chargePowerW: 7000,
        chargeAmps: 32,
        batteryLevel: 65,
        solarContributionW: 5000,
        gridContributionW: 2000,
        isHome: true,
      });

      const { total } = await db.vehicles.getVehicleChargeReadingsPaginated({
        limit: 10,
        offset: 0,
        to: "2000-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.vehicles
        .getVehicleChargeReadingsPaginated({
          limit: 10,
          offset: 0,
          to: "2099-01-01T00:00:00",
        });
      expect(total2).toBe(1);
    });

    it("getVehiclePollLogsPaginated filters by vehicleId", async () => {
      const base: VehiclePollLogInput = {
        vehicleId: "VIN1",
        vehicleName: "Car 1",
        isOnline: true,
        isPluggedIn: true,
        isCharging: false,
        batteryLevel: 72,
        chargeLimit: 80,
        chargeAmps: 16,
        chargeAmpsMax: 32,
        chargePowerKw: 0,
        chargerVoltage: 240,
        energyAddedKwh: 0,
        minutesToFull: 0,
        isHome: true,
      };

      await db.insertVehiclePollLog(base);
      await db.insertVehiclePollLog({
        ...base,
        vehicleId: "VIN2",
        vehicleName: "Car 2",
      });

      const { rows, total } = await db.logs.getVehiclePollLogsPaginated({
        limit: 10,
        offset: 0,
        vehicleId: "VIN1",
      });
      expect(total).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].vehicleId).toBe("VIN1");
    });

    it("getVehiclePollLogsPaginated filters by from date", async () => {
      await db.insertVehiclePollLog({
        vehicleId: "VIN1",
        vehicleName: "Car 1",
        isOnline: true,
        isPluggedIn: true,
        isCharging: false,
        batteryLevel: 72,
        chargeLimit: 80,
        chargeAmps: 16,
        chargeAmpsMax: 32,
        chargePowerKw: 0,
        chargerVoltage: 240,
        energyAddedKwh: 0,
        minutesToFull: 0,
        isHome: true,
      });

      const { total } = await db.logs.getVehiclePollLogsPaginated({
        limit: 10,
        offset: 0,
        from: "2099-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.logs.getVehiclePollLogsPaginated({
        limit: 10,
        offset: 0,
        from: "2000-01-01T00:00:00",
      });
      expect(total2).toBe(1);
    });

    it("getVehiclePollLogsPaginated filters by to date", async () => {
      await db.insertVehiclePollLog({
        vehicleId: "VIN1",
        vehicleName: "Car 1",
        isOnline: true,
        isPluggedIn: true,
        isCharging: false,
        batteryLevel: 72,
        chargeLimit: 80,
        chargeAmps: 16,
        chargeAmpsMax: 32,
        chargePowerKw: 0,
        chargerVoltage: 240,
        energyAddedKwh: 0,
        minutesToFull: 0,
        isHome: true,
      });

      const { total } = await db.logs.getVehiclePollLogsPaginated({
        limit: 10,
        offset: 0,
        to: "2000-01-01T00:00:00",
      });
      expect(total).toBe(0);

      const { total: total2 } = await db.logs.getVehiclePollLogsPaginated({
        limit: 10,
        offset: 0,
        to: "2099-01-01T00:00:00",
      });
      expect(total2).toBe(1);
    });
  });
});
