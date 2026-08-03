import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { AdapterVehicleChargeState, CallContext } from "@chargeha/shared";
import type { ChargerRow } from "@chargeha/server/db/types";
import type { VehicleRequestContext } from "../../../types.ts";
import { TeslaChargerMiddleware } from "./TeslaChargerMiddleware.ts";
import type { TeslaVehicleMiddleware } from "./TeslaVehicleMiddleware.ts";

describe("TeslaChargerMiddleware", () => {
  const buildRow = (overrides: Partial<ChargerRow> = {}): ChargerRow => ({
    id: "charger-1",
    name: "Test Charger",
    chargerAdapterType: "tesla",
    chargerConfig: "{}",
    mode: "auto",
    priority: 0,
    vehicleId: "vehicle-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

  const buildState = (
    overrides: Partial<AdapterVehicleChargeState> = {},
  ): AdapterVehicleChargeState => ({
    vehicleId: "VIN-TEST",
    batteryLevel: 60,
    chargeLimit: 80,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 7.4,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 3.2,
    minutesToFull: 30,
    chargePortOpen: true,
    vehicleName: "Test Tesla",
    lastUpdated: "2026-01-01T00:00:00.000Z",
    latitude: null,
    longitude: null,
    ...overrides,
  });

  // Plain-object stub matching only the surface TeslaChargerMiddleware
  // actually calls on the shared TeslaVehicleMiddleware instance.
  const buildSharedStub = (state: AdapterVehicleChargeState | null) => {
    const calls = {
      requestState: 0,
      getCachedState: 0,
      startCharging: 0,
      stopCharging: 0,
      setChargeAmps: 0,
    };
    const setChargeAmpsArgs: number[] = [];
    const shared = {
      requestState: (_ctx: VehicleRequestContext) => {
        calls.requestState++;
        return Promise.resolve(state);
      },
      getCachedState: () => {
        calls.getCachedState++;
        return state;
      },
      startCharging: (_ctx: CallContext) => {
        calls.startCharging++;
        return Promise.resolve(true);
      },
      stopCharging: (_ctx: CallContext) => {
        calls.stopCharging++;
        return Promise.resolve(true);
      },
      setChargeAmps: (amps: number, _ctx: CallContext) => {
        calls.setChargeAmps++;
        setChargeAmpsArgs.push(amps);
        return Promise.resolve(true);
      },
    };
    return {
      shared: shared as unknown as TeslaVehicleMiddleware,
      calls,
      setChargeAmpsArgs,
    };
  };

  const cc = (origin: string): CallContext => ({ origin, traceId: "test" });

  describe("toChargerState mapping", () => {
    it("maps a charging vehicle to status charging", () => {
      const { shared } = buildSharedStub(
        buildState({ isPluggedIn: true, isCharging: true }),
      );
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      expect(middleware.getCachedState()?.status).toBe("charging");
    });

    it("maps an unplugged vehicle to status available", () => {
      const { shared } = buildSharedStub(
        buildState({ isPluggedIn: false, isCharging: false }),
      );
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      expect(middleware.getCachedState()?.status).toBe("available");
    });

    it("maps plugged in, not charging, battery at limit to status finishing", () => {
      const { shared } = buildSharedStub(
        buildState({
          isPluggedIn: true,
          isCharging: false,
          batteryLevel: 80,
          chargeLimit: 80,
        }),
      );
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      expect(middleware.getCachedState()?.status).toBe("finishing");
    });

    it("maps plugged in, not charging, battery below limit to status suspended", () => {
      const { shared } = buildSharedStub(
        buildState({
          isPluggedIn: true,
          isCharging: false,
          batteryLevel: 50,
          chargeLimit: 80,
        }),
      );
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      expect(middleware.getCachedState()?.status).toBe("suspended");
    });

    it("formats statusDetail as SOC/limit/amps", () => {
      const { shared } = buildSharedStub(
        buildState({ batteryLevel: 55, chargeLimit: 90, chargeAmps: 12 }),
      );
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      expect(middleware.getCachedState()?.statusDetail).toBe(
        "SOC 55%/90%, 12A",
      );
    });
  });

  describe("getCachedState", () => {
    it("passes through null when the shared instance has no cached state", () => {
      const { shared } = buildSharedStub(null);
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      expect(middleware.getCachedState()).toBeNull();
    });
  });

  describe("commands", () => {
    it("delegates startCharging to the shared instance", async () => {
      const { shared, calls } = buildSharedStub(null);
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      const ok = await middleware.startCharging(cc("test:start"));
      expect(ok).toBe(true);
      expect(calls.startCharging).toBe(1);
    });

    it("delegates stopCharging to the shared instance", async () => {
      const { shared, calls } = buildSharedStub(null);
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      const ok = await middleware.stopCharging(cc("test:stop"));
      expect(ok).toBe(true);
      expect(calls.stopCharging).toBe(1);
    });

    it("delegates setChargeAmps to the shared instance with the same amps", async () => {
      const { shared, calls, setChargeAmpsArgs } = buildSharedStub(null);
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      const ok = await middleware.setChargeAmps(16, cc("test:amps"));
      expect(ok).toBe(true);
      expect(calls.setChargeAmps).toBe(1);
      expect(setChargeAmpsArgs).toEqual([16]);
    });
  });

  describe("shutdown", () => {
    it("resolves without touching the shared instance", async () => {
      // The vehicle role owns the shared instance's lifecycle — deleting the
      // charger row must not tear down vehicle data.
      const { shared, calls } = buildSharedStub(null);
      const middleware = new TeslaChargerMiddleware(buildRow(), shared);
      await middleware.shutdown();
      expect(calls.requestState).toBe(0);
      expect(calls.getCachedState).toBe(0);
      expect(calls.startCharging).toBe(0);
      expect(calls.stopCharging).toBe(0);
      expect(calls.setChargeAmps).toBe(0);
    });
  });
});
