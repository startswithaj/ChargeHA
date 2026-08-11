import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { AdapterVehicleChargeState, CallContext } from "@chargeha/shared";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type { ChargerRow } from "@chargeha/shared";
import type { VehicleRequestContext } from "@chargeha/shared/plugins";
import { SimulatedChargerMiddleware } from "./SimulatedChargerMiddleware.ts";
import type { SimulatedVehicleMiddleware } from "./SimulatedVehicleMiddleware.ts";

interface Handlers {
  requestState: (
    ctx: VehicleRequestContext,
  ) => Promise<AdapterVehicleChargeState | null>;
  getCachedState: () => AdapterVehicleChargeState | null;
  startCharging: () => Promise<boolean>;
  stopCharging: () => Promise<boolean>;
  setChargeAmps: (amps: number) => Promise<boolean>;
}

// Stub over the SimulatedVehicleMiddleware surface the charger view calls.
// Records call order and args; unstubbed methods throw so a test only
// exercising a subset of the interface still catches unexpected calls.
class StubVehicleMiddleware {
  readonly calls: string[] = [];
  requestStateArgs: VehicleRequestContext[] = [];

  constructor(private readonly handlers: Partial<Handlers> = {}) {}

  private static notStubbed(name: string): () => never {
    return () => {
      throw new Error(`StubVehicleMiddleware: ${name} not stubbed`);
    };
  }

  requestState(
    ctx: VehicleRequestContext,
  ): Promise<AdapterVehicleChargeState | null> {
    this.calls.push("requestState");
    this.requestStateArgs.push(ctx);
    return (this.handlers.requestState ??
      StubVehicleMiddleware.notStubbed("requestState"))(ctx);
  }

  getCachedState(): AdapterVehicleChargeState | null {
    this.calls.push("getCachedState");
    return (this.handlers.getCachedState ??
      StubVehicleMiddleware.notStubbed("getCachedState"))();
  }

  startCharging(): Promise<boolean> {
    this.calls.push("startCharging");
    return (this.handlers.startCharging ??
      StubVehicleMiddleware.notStubbed("startCharging"))();
  }

  stopCharging(): Promise<boolean> {
    this.calls.push("stopCharging");
    return (this.handlers.stopCharging ??
      StubVehicleMiddleware.notStubbed("stopCharging"))();
  }

  setChargeAmps(amps: number): Promise<boolean> {
    this.calls.push("setChargeAmps");
    return (this.handlers.setChargeAmps ??
      StubVehicleMiddleware.notStubbed("setChargeAmps"))(amps);
  }
}

describe("SimulatedChargerMiddleware", () => {
  const ctx: CallContext = { origin: "test", traceId: "test-trace" };

  const buildRow = (overrides: Partial<ChargerRow> = {}): ChargerRow => ({
    id: "charger-1",
    name: "Sim Charger",
    chargerAdapterType: "simulated",
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: "vehicle-1",
    kind: "vehicle_api",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

  const asShared = (
    stub: StubVehicleMiddleware,
  ): SimulatedVehicleMiddleware =>
    stub as unknown as SimulatedVehicleMiddleware;

  describe("requestState", () => {
    it("maps a charging state and forwards a solar/schedule/blockout-free context", async () => {
      const state = buildVehicleChargeState({
        isPluggedIn: true,
        isCharging: true,
        batteryLevel: 50,
        chargeLimit: 80,
      });
      const stub = new StubVehicleMiddleware({
        requestState: () => Promise.resolve(state),
      });
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );

      const result = await middleware.requestState(ctx);

      expect(result?.status).toBe("charging");
      expect(stub.requestStateArgs).toEqual([{
        origin: "test",
        traceId: "test-trace",
        hasSolar: false,
        hasSchedule: false,
        hasBlockout: false,
      }]);
    });

    it("returns null when the shared middleware has no state", async () => {
      const stub = new StubVehicleMiddleware({
        requestState: () => Promise.resolve(null),
      });
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );

      expect(await middleware.requestState(ctx)).toBeNull();
    });
  });

  describe("status mapping", () => {
    const statusFor = async (
      overrides: Partial<AdapterVehicleChargeState>,
    ) => {
      const state = buildVehicleChargeState(overrides);
      const stub = new StubVehicleMiddleware({
        requestState: () => Promise.resolve(state),
      });
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );
      return (await middleware.requestState(ctx))?.status;
    };

    it("not plugged in -> available", async () => {
      expect(await statusFor({ isPluggedIn: false })).toBe("available");
    });

    it("plugged in and charging -> charging", async () => {
      expect(await statusFor({ isPluggedIn: true, isCharging: true })).toBe(
        "charging",
      );
    });

    it("plugged in, not charging, at limit -> finishing", async () => {
      expect(
        await statusFor({
          isPluggedIn: true,
          isCharging: false,
          batteryLevel: 80,
          chargeLimit: 80,
        }),
      ).toBe("finishing");
    });

    it("plugged in, not charging, below limit -> suspended", async () => {
      expect(
        await statusFor({
          isPluggedIn: true,
          isCharging: false,
          batteryLevel: 50,
          chargeLimit: 80,
        }),
      ).toBe("suspended");
    });
  });

  describe("getCachedState", () => {
    it("returns null when the shared middleware has no cached state", () => {
      const stub = new StubVehicleMiddleware({ getCachedState: () => null });
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );

      expect(middleware.getCachedState()).toBeNull();
    });

    it("maps the shared middleware's cached state", () => {
      const state = buildVehicleChargeState({ energyAddedKwh: 3.5 });
      const stub = new StubVehicleMiddleware({
        getCachedState: () => state,
      });
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );

      expect(middleware.getCachedState()?.energyAddedKwh).toBe(3.5);
    });
  });

  describe("command delegation", () => {
    it("startCharging returns the shared middleware's result", async () => {
      const stub = new StubVehicleMiddleware({
        startCharging: () => Promise.resolve(true),
      });
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );

      expect(await middleware.startCharging(ctx)).toBe(true);
      expect(stub.calls).toEqual(["startCharging"]);
    });

    it("stopCharging returns the shared middleware's result", async () => {
      const stub = new StubVehicleMiddleware({
        stopCharging: () => Promise.resolve(false),
      });
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );

      expect(await middleware.stopCharging(ctx)).toBe(false);
      expect(stub.calls).toEqual(["stopCharging"]);
    });

    it("setChargeAmps passes amps through and returns the result", async () => {
      const stub = new StubVehicleMiddleware({
        setChargeAmps: (amps) => Promise.resolve(amps === 16),
      });
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );

      expect(await middleware.setChargeAmps(16, ctx)).toBe(true);
      expect(stub.calls).toEqual(["setChargeAmps"]);
    });
  });

  describe("shutdown", () => {
    it("resolves without touching the shared middleware", async () => {
      const stub = new StubVehicleMiddleware();
      const middleware = new SimulatedChargerMiddleware(
        buildRow(),
        asShared(stub),
      );

      await middleware.shutdown();

      expect(stub.calls).toEqual([]);
    });
  });
});
