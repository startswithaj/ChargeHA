import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SolarAllocator } from "./SolarAllocator.ts";
import type { ControllerConfig, EngineVehicleInput } from "./types.ts";
import type { EnergyData, VehicleChargeState } from "../types.ts";

describe("SolarAllocator", () => {
  const BASE_STATE: VehicleChargeState = {
    vehicleId: "v1",
    batteryLevel: 50,
    chargeLimit: 80,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 0,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 0,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: true,
    vehicleName: "EV1",
    lastUpdated: "2024-01-01T00:00:00Z",
    latitude: null,
    longitude: null,
    isHome: true,
  };

  const BASE_ENERGY: EnergyData = {
    solarProductionW: 5000,
    gridPowerW: -3000,
    homeConsumptionW: 2000,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2024-01-01T00:00:00Z",
  };

  const BASE_CONFIG: ControllerConfig = {
    chargingEnabled: true,
    controllerLoopSeconds: 60,
    solarTrackingEnabled: true,
    solarTrackingMode: "solar_only",
    solarReference: "excess",
    solarMarginKw: 0,
    minSolarGenerationKw: 1,
    minExcessSolarKw: null,
    gridVoltage: 230,
    threePhaseCharger: false,
    consumptionExcludesCharging: false,
    gracePeriodMinutes: 6,
    cooldownPeriodMinutes: 15,
    batteryPriorityEnabled: false,
    batteryPriorityLimit: 0,
    priorityChargingEnabled: true,
    timezone: "",
    ampDebounceThreshold: 2,
    ampDebounceSettleMinutes: 3,
  };

  const makeVehicle = (
    id: string,
    priority: number,
    overrides?: Partial<VehicleChargeState>,
  ): EngineVehicleInput => ({
    id,
    vehicleId: id,
    name: `EV ${id}`,
    mode: "auto",
    priority,
    state: {
      ...BASE_STATE,
      vehicleId: id,
      vehicleName: `EV ${id}`,
      ...overrides,
    },
  });

  describe("resolveVoltage", () => {
    it("uses vehicle voltage when >= 100V", () => {
      const state = { ...BASE_STATE, chargerVoltage: 240 };
      expect(
        SolarAllocator.resolveVoltage(
          state.chargerVoltage,
          BASE_ENERGY,
          BASE_CONFIG.gridVoltage,
        ),
      )
        .toBe(
          240,
        );
    });

    it("falls back to grid voltage from energy when vehicle voltage < 100", () => {
      const state = { ...BASE_STATE, chargerVoltage: 0 };
      const energy = { ...BASE_ENERGY, gridVoltageV: 235 };
      expect(
        SolarAllocator.resolveVoltage(
          state.chargerVoltage,
          energy,
          BASE_CONFIG.gridVoltage,
        ),
      ).toBe(
        235,
      );
    });

    it("falls back to config grid voltage when no energy grid voltage", () => {
      const state = { ...BASE_STATE, chargerVoltage: 0 };
      const config = { ...BASE_CONFIG, gridVoltage: 220 };
      expect(
        SolarAllocator.resolveVoltage(
          state.chargerVoltage,
          BASE_ENERGY,
          config.gridVoltage,
        ),
      ).toBe(
        220,
      );
    });

    it("falls back to config when energy is null", () => {
      const state = { ...BASE_STATE, chargerVoltage: 0 };
      const config = { ...BASE_CONFIG, gridVoltage: 220 };
      expect(
        SolarAllocator.resolveVoltage(
          state.chargerVoltage,
          null,
          config.gridVoltage,
        ),
      ).toBe(220);
    });
  });

  describe("calculateAvailableSolar", () => {
    it("uses grid export in excess mode", () => {
      const config = { ...BASE_CONFIG, solarReference: "excess" as const };
      const energy = { ...BASE_ENERGY, gridPowerW: -2000 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        BASE_STATE,
        230,
        1,
      );
      expect(result).toBe(2000);
    });

    it("uses solar production in gross mode", () => {
      const config = { ...BASE_CONFIG, solarReference: "gross" as const };
      const energy = { ...BASE_ENERGY, solarProductionW: 4000 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        BASE_STATE,
        230,
        1,
      );
      expect(result).toBe(4000);
    });

    it("does not add back charging load in gross mode", () => {
      // Panel output never had the car's draw subtracted from it, so adding it
      // back would double-count and let the car ramp itself up indefinitely.
      const config = { ...BASE_CONFIG, solarReference: "gross" as const };
      const energy = { ...BASE_ENERGY, solarProductionW: 4000 };
      const state = { ...BASE_STATE, isCharging: true, chargeAmps: 10 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        state,
        230,
        1,
      );
      expect(result).toBe(4000);
    });

    it("subtracts home battery discharge from surplus", () => {
      const energy = {
        ...BASE_ENERGY,
        solarProductionW: 3000,
        gridPowerW: 0,
        batteryPowerW: 1000,
      };
      const result = SolarAllocator.calculateAvailableSolar(
        BASE_CONFIG,
        energy,
        BASE_STATE,
        230,
        1,
      );
      // Grid neutral, but 1000W is coming out of the battery — not solar.
      expect(result).toBe(0);
    });

    it("counts battery charging as unavailable, not as surplus", () => {
      const energy = {
        ...BASE_ENERGY,
        solarProductionW: 5000,
        gridPowerW: -1000,
        batteryPowerW: -2000,
      };
      const result = SolarAllocator.calculateAvailableSolar(
        BASE_CONFIG,
        energy,
        BASE_STATE,
        230,
        1,
      );
      // Battery charging already suppressed export; it keeps first claim on
      // the surplus, so only the 1000W actually exported is available.
      expect(result).toBe(1000);
    });

    it("does not let an ESS holding the grid at zero fabricate surplus", () => {
      // Regression: real-world log — 144W production, grid pinned at ~0 by a
      // 2kW battery discharge, car pulling 8A. The add-back previously
      // resurfaced the car's own draw as 1886W of "available solar".
      const energy = {
        ...BASE_ENERGY,
        solarProductionW: 144,
        gridPowerW: 2,
        homeConsumptionW: 2212,
        batteryPowerW: 2066,
      };
      const state = { ...BASE_STATE, isCharging: true, chargeAmps: 8 };
      const result = SolarAllocator.calculateAvailableSolar(
        BASE_CONFIG,
        energy,
        state,
        236,
        1,
      );
      expect(result).toBe(0);
    });

    it("caps surplus at current solar production", () => {
      const energy = {
        ...BASE_ENERGY,
        solarProductionW: 1000,
        gridPowerW: -500,
      };
      const state = { ...BASE_STATE, isCharging: true, chargeAmps: 10 };
      const result = SolarAllocator.calculateAvailableSolar(
        BASE_CONFIG,
        energy,
        state,
        230,
        1,
      );
      // 500 + 2300 = 2800 claimed, but the panels are only making 1000W.
      expect(result).toBe(1000);
    });

    it("adds back charging load when meter includes EV consumption", () => {
      const config = { ...BASE_CONFIG, consumptionExcludesCharging: false };
      const energy = { ...BASE_ENERGY, gridPowerW: -1000 };
      const state = { ...BASE_STATE, isCharging: true, chargeAmps: 10 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        state,
        230,
        1,
      );
      // -(-1000) + 10*230*1 = 1000 + 2300 = 3300
      expect(result).toBe(3300);
    });

    it("does not add back charging load when consumption excludes charging", () => {
      const config = { ...BASE_CONFIG, consumptionExcludesCharging: true };
      const energy = { ...BASE_ENERGY, gridPowerW: -1000 };
      const state = { ...BASE_STATE, isCharging: true, chargeAmps: 10 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        state,
        230,
        1,
      );
      expect(result).toBe(1000);
    });

    it("does not add back charging load when not charging", () => {
      const config = { ...BASE_CONFIG, consumptionExcludesCharging: false };
      const energy = { ...BASE_ENERGY, gridPowerW: -1000 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        BASE_STATE,
        230,
        1,
      );
      expect(result).toBe(1000);
    });

    it("subtracts solar margin", () => {
      const config = { ...BASE_CONFIG, solarMarginKw: 0.5 };
      const energy = { ...BASE_ENERGY, gridPowerW: -2000 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        BASE_STATE,
        230,
        1,
      );
      // 2000 - 500 = 1500
      expect(result).toBe(1500);
    });

    it("floors at zero when margin exceeds available", () => {
      const config = { ...BASE_CONFIG, solarMarginKw: 5 };
      const energy = { ...BASE_ENERGY, gridPowerW: -2000 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        BASE_STATE,
        230,
        1,
      );
      expect(result).toBe(0);
    });

    it("accounts for three-phase charging", () => {
      const config = { ...BASE_CONFIG, consumptionExcludesCharging: false };
      // Production must cover export + add-back, else the production ceiling
      // (not the phase math) is what's under test.
      const energy = {
        ...BASE_ENERGY,
        solarProductionW: 9000,
        gridPowerW: -1000,
      };
      const state = { ...BASE_STATE, isCharging: true, chargeAmps: 10 };
      const result = SolarAllocator.calculateAvailableSolar(
        config,
        energy,
        state,
        230,
        3,
      );
      // 1000 + 10*230*3 = 1000 + 6900 = 7900
      expect(result).toBe(7900);
    });
  });

  describe("waterfall", () => {
    it("returns empty map when no energy data", () => {
      const vehicles = [makeVehicle("v1", 1), makeVehicle("v2", 2)];
      const result = SolarAllocator.waterfall(vehicles, BASE_CONFIG, null);
      expect(result.size).toBe(0);
    });

    it("returns empty map with fewer than 2 eligible vehicles", () => {
      const vehicles = [makeVehicle("v1", 1)];
      const result = SolarAllocator.waterfall(
        vehicles,
        BASE_CONFIG,
        BASE_ENERGY,
      );
      expect(result.size).toBe(0);
    });

    it("gives all amps to priority 1 when it can absorb everything", () => {
      const energy = { ...BASE_ENERGY, gridPowerW: -2300 };
      const vehicles = [
        makeVehicle("v1", 1, { chargeAmpsMax: 32 }),
        makeVehicle("v2", 2, { chargeAmpsMax: 32 }),
      ];
      const result = SolarAllocator.waterfall(vehicles, BASE_CONFIG, energy);
      // 2300W / 230V = 10A total — all to v1
      expect(result.get("v1")).toBe(10);
      expect(result.get("v2")).toBe(0);
    });

    it("overflows to priority 2 when priority 1 is full", () => {
      const energy = { ...BASE_ENERGY, gridPowerW: -4600 };
      const vehicles = [
        makeVehicle("v1", 1, { chargeAmpsMax: 10 }),
        makeVehicle("v2", 2, { chargeAmpsMax: 32 }),
      ];
      const result = SolarAllocator.waterfall(vehicles, BASE_CONFIG, energy);
      // 4600W / 230V = 20A total. v1 gets 10 (max), v2 gets 10
      expect(result.get("v1")).toBe(10);
      expect(result.get("v2")).toBe(10);
    });

    it("handles three vehicles in priority order", () => {
      // Production must cover the export being split, else the production
      // ceiling caps the total below 30A.
      const energy = {
        ...BASE_ENERGY,
        solarProductionW: 7000,
        gridPowerW: -6900,
      };
      const vehicles = [
        makeVehicle("v1", 1, { chargeAmpsMax: 15 }),
        makeVehicle("v2", 2, { chargeAmpsMax: 10 }),
        makeVehicle("v3", 3, { chargeAmpsMax: 32 }),
      ];
      const result = SolarAllocator.waterfall(vehicles, BASE_CONFIG, energy);
      // 6900W / 230V = 30A total. v1=15, v2=10, v3=5
      expect(result.get("v1")).toBe(15);
      expect(result.get("v2")).toBe(10);
      expect(result.get("v3")).toBe(5);
    });

    it("gives nothing to lower priority when budget exhausted", () => {
      const energy = { ...BASE_ENERGY, gridPowerW: -2300 };
      const vehicles = [
        makeVehicle("v1", 1, { chargeAmpsMax: 32 }),
        makeVehicle("v2", 2, { chargeAmpsMax: 32 }),
        makeVehicle("v3", 3, { chargeAmpsMax: 32 }),
      ];
      const result = SolarAllocator.waterfall(vehicles, BASE_CONFIG, energy);
      // 10A total, v1 gets all
      expect(result.get("v1")).toBe(10);
      expect(result.get("v2")).toBe(0);
      expect(result.get("v3")).toBe(0);
    });

    it("excludes vehicles not plugged in", () => {
      const energy = { ...BASE_ENERGY, gridPowerW: -4600 };
      const vehicles = [
        makeVehicle("v1", 1, { isPluggedIn: false }),
        makeVehicle("v2", 2, { chargeAmpsMax: 32 }),
        makeVehicle("v3", 3, { chargeAmpsMax: 32 }),
      ];
      const result = SolarAllocator.waterfall(vehicles, BASE_CONFIG, energy);
      // v1 excluded, only v2+v3 eligible. 20A total → v2 gets 20
      expect(result.has("v1")).toBe(false);
      expect(result.get("v2")).toBe(20);
      expect(result.get("v3")).toBe(0);
    });

    it("excludes vehicles at charge limit", () => {
      const energy = { ...BASE_ENERGY, gridPowerW: -4600 };
      const vehicles = [
        makeVehicle("v1", 1, { batteryLevel: 80, chargeLimit: 80 }),
        makeVehicle("v2", 2, { chargeAmpsMax: 32 }),
        makeVehicle("v3", 3, { chargeAmpsMax: 32 }),
      ];
      const result = SolarAllocator.waterfall(vehicles, BASE_CONFIG, energy);
      expect(result.has("v1")).toBe(false);
      expect(result.get("v2")).toBe(20);
    });
  });
});
