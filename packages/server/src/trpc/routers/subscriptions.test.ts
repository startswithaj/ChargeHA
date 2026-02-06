import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type {
  CumulativeEnergyData,
  EnergyData,
  SSEEvent,
  VehicleChargeState,
} from "@chargeha/shared";
import { TypedEventEmitter } from "../../services/TypedEventEmitter.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";
import { MockPoller } from "../../test-helpers/MockPoller.ts";
import { MockVehicleManager } from "../../test-helpers/MockVehicleManager.ts";

describe("Subscriptions tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  const REALTIME: EnergyData = {
    solarProductionW: 5000,
    gridPowerW: -2000,
    homeConsumptionW: 3000,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const CUMULATIVE: CumulativeEnergyData = {
    solarProducedWh: 50000,
    gridImportedWh: 10000,
    gridExportedWh: 20000,
    dailySolarProducedWh: 5000,
    dailyGridImportWh: 1000,
    dailyGridExportWh: 2000,
  };

  const VEHICLE_STATE: VehicleChargeState = {
    vehicleId: "vehicle-1",
    vehicleName: "Test Car",
    batteryLevel: 80,
    chargeLimit: 90,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 0,
    chargerVoltage: 240,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: true,
    lastUpdated: "2024-01-01T00:00:00.000Z",
    latitude: null,
    longitude: null,
    isHome: null,
  };

  const makeContext = (
    eventEmitter: TypedEventEmitter,
    poller: MockPoller,
    vehicleManager: MockVehicleManager,
    signal?: AbortSignal,
  ) =>
    createCaller(
      throwingMock<TrpcContext>("TrpcContext", {
        poller: poller as unknown as TrpcContext["poller"],
        vehicleManager: vehicleManager as unknown as TrpcContext[
          "vehicleManager"
        ],
        eventEmitter,
      }),
      signal ? { signal } : undefined,
    );

  const collectEvents = async (
    eventEmitter: TypedEventEmitter,
    poller: MockPoller,
    vehicleManager: MockVehicleManager,
    count: number,
    emitAfterStart?: () => void,
  ): Promise<SSEEvent[]> => {
    const abortController = new AbortController();

    const caller = makeContext(
      eventEmitter,
      poller,
      vehicleManager,
      abortController.signal,
    );

    const iterable = await caller.subscription.onEvents();

    const results: SSEEvent[] = [];

    // Schedule live events with a short delay so the generator enters its wait loop
    if (emitAfterStart) {
      setTimeout(emitAfterStart, 10);
    }

    const iterator = (iterable as AsyncIterable<SSEEvent>)[
      Symbol.asyncIterator
    ]();
    const pump = async (): Promise<SSEEvent[]> => {
      const next = await iterator.next();
      if (next.done) return results;
      results.push(next.value);
      if (results.length >= count) {
        abortController.abort();
        return results;
      }
      return pump();
    };
    await pump();

    return results;
  };

  describe("subscription.onEvents", () => {
    it("emits initial energy snapshot", async () => {
      const eventEmitter = new TypedEventEmitter();
      const poller = new MockPoller();
      poller.setSnapshot(REALTIME, CUMULATIVE);
      const vehicleManager = new MockVehicleManager();

      const results = await collectEvents(
        eventEmitter,
        poller,
        vehicleManager,
        1,
      );

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("energy_update");
      expect(results[0].data).toEqual({ ...REALTIME, ...CUMULATIVE });
    });

    it("emits initial vehicle states", async () => {
      const eventEmitter = new TypedEventEmitter();
      const poller = new MockPoller();
      const vehicleManager = new MockVehicleManager();
      vehicleManager.addState("vehicle-1", VEHICLE_STATE);
      vehicleManager.addState("vehicle-2", {
        ...VEHICLE_STATE,
        vehicleId: "vehicle-2",
        vehicleName: "Second Car",
      });

      // No energy snapshot, so expect 2 vehicle_update events
      const results = await collectEvents(
        eventEmitter,
        poller,
        vehicleManager,
        2,
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        type: "vehicle_update",
        data: VEHICLE_STATE,
      });
      expect(results[1].type).toBe("vehicle_update");
      expect(results[1].data).toEqual(
        expect.objectContaining({ vehicleId: "vehicle-2" }),
      );
    });

    it("emits initial energy snapshot followed by vehicle states", async () => {
      const eventEmitter = new TypedEventEmitter();
      const poller = new MockPoller();
      poller.setSnapshot(REALTIME, CUMULATIVE);
      const vehicleManager = new MockVehicleManager();
      vehicleManager.addState("vehicle-1", VEHICLE_STATE);

      const results = await collectEvents(
        eventEmitter,
        poller,
        vehicleManager,
        2,
      );

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe("energy_update");
      expect(results[1].type).toBe("vehicle_update");
    });

    it("emits initial vehicle errors for vehicles with errors", async () => {
      const eventEmitter = new TypedEventEmitter();
      const poller = new MockPoller();
      const vehicleManager = new MockVehicleManager();
      vehicleManager.addState("vehicle-1", VEHICLE_STATE);
      vehicleManager.setVehicleError(
        "vehicle-1",
        new Error("Token expired"),
      );

      // Expect: 1 vehicle_update + 1 vehicle_error
      const results = await collectEvents(
        eventEmitter,
        poller,
        vehicleManager,
        2,
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        type: "vehicle_update",
        data: VEHICLE_STATE,
      });
      expect(results[1]).toEqual({
        type: "vehicle_error",
        data: {
          vehicleId: "vehicle-1",
          vehicleName: "Test Car",
          error: "Token expired",
        },
      });
    });

    it("forwards live energy updates", async () => {
      const eventEmitter = new TypedEventEmitter();
      const poller = new MockPoller();
      poller.setSnapshot(REALTIME, CUMULATIVE);
      const vehicleManager = new MockVehicleManager();

      const liveData = {
        ...REALTIME,
        ...CUMULATIVE,
        solarProductionW: 9000,
      };

      const results = await collectEvents(
        eventEmitter,
        poller,
        vehicleManager,
        2,
        () => eventEmitter.emit("energy_update", liveData),
      );

      expect(results).toHaveLength(2);
      // First is initial snapshot
      expect(results[0].type).toBe("energy_update");
      expect(
        (results[0].data as EnergyData & CumulativeEnergyData)
          .solarProductionW,
      ).toBe(5000);
      // Second is live update
      expect(results[1].type).toBe("energy_update");
      expect(
        (results[1].data as EnergyData & CumulativeEnergyData)
          .solarProductionW,
      ).toBe(9000);
    });

    it("forwards live vehicle updates", async () => {
      const eventEmitter = new TypedEventEmitter();
      const poller = new MockPoller();
      const vehicleManager = new MockVehicleManager();
      vehicleManager.addState("vehicle-1", VEHICLE_STATE);

      const liveUpdate: VehicleChargeState = {
        ...VEHICLE_STATE,
        batteryLevel: 85,
        isCharging: true,
      };

      const results = await collectEvents(
        eventEmitter,
        poller,
        vehicleManager,
        2,
        () => eventEmitter.emit("vehicle_update", liveUpdate),
      );

      expect(results).toHaveLength(2);
      // First is initial vehicle state
      expect(results[0].type).toBe("vehicle_update");
      expect((results[0].data as VehicleChargeState).batteryLevel).toBe(80);
      // Second is live update
      expect(results[1].type).toBe("vehicle_update");
      expect((results[1].data as VehicleChargeState).batteryLevel).toBe(85);
      expect((results[1].data as VehicleChargeState).isCharging).toBe(true);
    });

    it("forwards live vehicle errors", async () => {
      const eventEmitter = new TypedEventEmitter();
      const poller = new MockPoller();
      const vehicleManager = new MockVehicleManager();

      const errorData = {
        vehicleId: "vehicle-1",
        vehicleName: "Test Car",
        error: "Vehicle offline",
        source: "fetch" as const,
      };

      const results = await collectEvents(
        eventEmitter,
        poller,
        vehicleManager,
        1,
        () => eventEmitter.emit("vehicle_error", errorData),
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: "vehicle_error",
        data: errorData,
      });
    });

    it("cleans up EventEmitter listeners on abort", async () => {
      const eventEmitter = new TypedEventEmitter();
      const poller = new MockPoller();
      const vehicleManager = new MockVehicleManager();

      const abortController = new AbortController();

      const caller = makeContext(
        eventEmitter,
        poller,
        vehicleManager,
        abortController.signal,
      );

      // Abort before iterating so the generator runs its finally block
      abortController.abort();

      const iterable = await caller.subscription.onEvents();
      const results: SSEEvent[] = await Array.fromAsync(
        iterable as AsyncIterable<SSEEvent>,
      );

      // Emit after abort — should not be received
      eventEmitter.emit("energy_update", { ...REALTIME, ...CUMULATIVE });
      expect(results).toHaveLength(0);
    });
  });
});
