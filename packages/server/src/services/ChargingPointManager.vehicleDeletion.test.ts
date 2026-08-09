import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type {
  CallContext,
  ChargerInfo,
  ChargerState,
  VehicleChargeState,
} from "@chargeha/shared";
import { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow } from "../db/types.ts";
import { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  ChargerRowConfig,
} from "@chargeha/shared/plugins";
import type { VehicleManager } from "./VehicleManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { ChargingPointManager } from "./ChargingPointManager.ts";
import { Logger } from "../lib/Logger.ts";
import { MockEventEmitter } from "../test-helpers/MockEventEmitter.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

/** What happens to charging points and their schedules when the vehicle a
 *  point is attached to is deleted.
 *
 *  Uses a real in-memory database rather than a stubbed one, because the
 *  question is partly about what `AppDatabase.deleteCharger` cascades — a
 *  stub would answer with whatever the stub was written to do. */
/** Inert middleware — these tests are about row lifecycle, not charging.
 *  Its ChargerInfo lives on the class because the lint rules put classes at
 *  module scope but keep consts inside describe(). */
class StubChargerMiddleware implements ChargerMiddleware {
  private readonly info: ChargerInfo = {
    id: "sim",
    name: "Simulated",
    vendor: "sim",
    model: "sim-1",
    firmwareVersion: "1.0",
    maxAmps: 32,
    minAmps: 6,
    phases: 1,
    connectorCount: 1,
    controlMode: "amps",
  };

  requestState(_ctx: CallContext): Promise<ChargerState | null> {
    return Promise.resolve(null);
  }
  getCachedState(): ChargerState | null {
    return null;
  }
  getChargerInfo(_ctx: CallContext): Promise<ChargerInfo> {
    return Promise.resolve(this.info);
  }
  startCharging(_ctx: CallContext): Promise<boolean> {
    return Promise.resolve(true);
  }
  stopCharging(_ctx: CallContext): Promise<boolean> {
    return Promise.resolve(true);
  }
  setChargeAmps(_amps: number, _ctx: CallContext): Promise<boolean> {
    return Promise.resolve(true);
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

describe("ChargingPointManager vehicle deletion", () => {
  const testLogger = new Logger("ChargingPointManager", "error");
  const SOLAR_DEFAULTS = {
    solarTrackingEnabled: true,
    solarTrackingMode: "solar_only" as const,
    solarReference: "excess" as const,
    solarMarginKw: 0,
    minSolarGenerationKw: 0.2,
    minExcessSolarKw: null,
    gridVoltage: 230,
    threePhaseCharger: false,
    consumptionExcludesCharging: false,
    gracePeriodMinutes: 6,
    cooldownPeriodMinutes: 15,
    ampDebounceThreshold: 2,
    ampDebounceSettleMinutes: 3,
  };

  let db: AppDatabase;
  let manager: ChargingPointManager;
  let emitter: MockEventEmitter;

  const registerPlugin = (
    registry: ChargerPluginRegistry,
    type: string,
  ): void => {
    registry.register(throwingMock<ChargerPlugin>("ChargerPlugin", {
      id: type,
      displayName: type,
      createChargerMiddleware: (
        _row: ChargerRow,
        _resolved: ChargerRowConfig,
      ) => Promise.resolve(new StubChargerMiddleware()),
    }));
  };

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();

    const registry = new ChargerPluginRegistry();
    registerPlugin(registry, "sim");
    registerPlugin(registry, "tesla");

    emitter = new MockEventEmitter();
    const vehicleManager = throwingMock<VehicleManager>("VehicleManager", {
      getAllStates: () =>
        Promise.resolve(new Map<string, VehicleChargeState>()),
      loadIsUnmetered: () => false,
    });
    const poller = throwingMock<EnergyPoller>("EnergyPoller", {
      tryGetRealtimeSnapshot: () => null,
    });
    const configService = throwingMock<ConfigService>("ConfigService", {
      getSolar: () => Promise.resolve({ ...SOLAR_DEFAULTS }),
    });

    manager = new ChargingPointManager(
      db,
      registry,
      vehicleManager,
      poller,
      configService,
      emitter as unknown as TypedEventEmitter,
      testLogger,
    );
  });

  afterEach(() => {
    db.close();
  });

  const seedVehicle = async (id: string): Promise<void> => {
    await db.upsertVehicle({
      id,
      name: `Car ${id}`,
      adapterType: "tesla",
      config: "{}",
      priority: 1,
      mode: "auto",
    });
  };

  const chargerSchedule = async (
    id: string,
    chargerId: string,
  ): Promise<void> => {
    await db.createSchedule({
      id,
      vehicleId: null,
      chargerId,
      scheduleType: "charge",
      startTime: "00:00",
      endTime: "06:00",
      days: ["mon"],
      chargeAmps: 32,
      chargeLimitPct: null,
    });
  };

  const remainingScheduleIds = async (): Promise<string[]> =>
    (await db.getSchedules()).map((s) => s.id).toSorted();

  describe("a smart charger the deleted vehicle was assigned to", () => {
    /** Sets up what a user actually has: a wallbox they own, a car assigned
     *  to it through the real assignment path, and a schedule they set on the
     *  wallbox itself. */
    const setUpAssignedWallbox = async (): Promise<void> => {
      await seedVehicle("VIN1");
      await db.upsertCharger({
        id: "cp-wallbox",
        name: "Wallbox",
        chargerAdapterType: "sim",
        kind: "smart",
      });
      await chargerSchedule("sched-wallbox", "cp-wallbox");
      await manager.init();
      await manager.setChargerVehicleId("cp-wallbox", "VIN1");

      const assigned = await db.getCharger("cp-wallbox");
      assertExists(assigned);
      expect(assigned.vehicleId).toBe("VIN1");
    };

    it("keeps the charger row when its assigned vehicle is deleted", async () => {
      await setUpAssignedWallbox();

      // What VehicleManager.deleteVehicle does: drop the row, then announce
      // it. init() subscribed syncVehicleChargingPoints to that event.
      await db.deleteVehicle("VIN1");
      await manager.syncVehicleChargingPoints();

      const wallbox = await db.getCharger("cp-wallbox");
      expect(wallbox).not.toBeNull();
    });

    it("clears the dangling assignment rather than leaving a ghost id", async () => {
      await setUpAssignedWallbox();

      await db.deleteVehicle("VIN1");
      await manager.syncVehicleChargingPoints();

      const wallbox = await db.getCharger("cp-wallbox");
      assertExists(wallbox);
      expect(wallbox.vehicleId).toBeNull();
    });

    it("keeps the schedules set on that charger", async () => {
      await setUpAssignedWallbox();

      await db.deleteVehicle("VIN1");
      await manager.syncVehicleChargingPoints();

      expect(await remainingScheduleIds()).toEqual(["sched-wallbox"]);
    });
  });

  describe("the deleted vehicle's own API charging point", () => {
    it("deletes the point, which exists only to drive that vehicle", async () => {
      await seedVehicle("VIN1");
      await db.upsertCharger({
        id: "cp-VIN1",
        name: "Car VIN1",
        chargerAdapterType: "tesla",
        kind: "vehicle_api",
        vehicleId: "VIN1",
      });
      await chargerSchedule("sched-api", "cp-VIN1");
      await manager.init();

      await db.deleteVehicle("VIN1");
      await manager.syncVehicleChargingPoints();

      expect(await db.getCharger("cp-VIN1")).toBeNull();
      // Its schedules go with it: the hardware they described is gone.
      expect(await remainingScheduleIds()).toEqual([]);
    });

    it("leaves points belonging to other vehicles alone", async () => {
      await seedVehicle("VIN1");
      await seedVehicle("VIN2");
      await db.upsertCharger({
        id: "cp-VIN2",
        name: "Car VIN2",
        chargerAdapterType: "tesla",
        kind: "vehicle_api",
        vehicleId: "VIN2",
      });
      await manager.init();

      await db.deleteVehicle("VIN1");
      await manager.syncVehicleChargingPoints();

      expect(await db.getCharger("cp-VIN2")).not.toBeNull();
    });
  });
});
