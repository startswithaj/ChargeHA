import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ServiceError } from "../lib/ServiceError.ts";
import { VehicleService } from "./VehicleService.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { Logger } from "../lib/Logger.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleRow } from "../db/types.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { CommandResult } from "./VehicleManager.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { VehicleChargeState } from "@chargeha/shared";

describe("VehicleService", () => {
  const testLogger = new Logger("VehicleServiceTest", "error");

  const VEHICLE_ROW: VehicleRow = {
    id: "v1",
    name: "Test Car",
    adapterType: "tesla",
    priority: 1,
    config: "{}",
    mode: "auto",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const CHARGE_STATE: VehicleChargeState = {
    vehicleId: "v1",
    batteryLevel: 60,
    chargeLimit: 80,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 0,
    chargeAmpsMax: 16,
    chargeAmpsMin: 0,
    chargePowerKw: 0,
    chargerVoltage: 240,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: false,
    vehicleName: "Test Car",
    lastUpdated: new Date().toISOString(),
    latitude: null,
    longitude: null,
    isHome: null,
  };

  // ---------------------------------------------------------------------------
  // Mock factories
  // ---------------------------------------------------------------------------

  function makeMockDb(
    overrides: Partial<AppDatabase> = {},
    vehicles: VehicleRow[] = [],
  ) {
    return {
      getVehicles: () => Promise.resolve(vehicles),
      getVehicle: (id: string) =>
        Promise.resolve(vehicles.find((v) => v.id === id) ?? null),
      getNextVehiclePriority: () => Promise.resolve(1),
      upsertVehicle: () => Promise.resolve(),
      deleteSchedulesByVehicle: () => Promise.resolve(),
      deleteVehicle: () => Promise.resolve(),
      resequenceVehiclePriorities: () => Promise.resolve(),
      updateVehicleMode: () => Promise.resolve(),
      updateVehiclePriority: () => Promise.resolve(),
      ...overrides,
    } as unknown as AppDatabase;
  }

  function makeMockVehicleManager(
    overrides: Partial<VehicleManager> = {},
  ): VehicleManager {
    return {
      getState: () => Promise.resolve(null),
      getVehicleError: () => null,
      addVehicle: () => Promise.resolve(),
      removeVehicle: () => Promise.resolve(),
      deleteVehicle: () => Promise.resolve(),
      requestState: () => Promise.resolve(CHARGE_STATE),
      startChargingAt: () =>
        Promise.resolve(
          { success: true, state: CHARGE_STATE } as CommandResult,
        ),
      stopCharging: () =>
        Promise.resolve(
          { success: true, state: CHARGE_STATE } as CommandResult,
        ),
      isBackedOff: () => ({ backedOff: false }),
      isVehicleAwake: () => true,
      ...overrides,
    } as unknown as VehicleManager;
  }

  interface MockPlugin {
    id: string;
    displayName: string;
    settingsComponentKey: string | null;
    getRouter: () => unknown;
    getCommandStatus?: () => Promise<
      { commandsDisabled: boolean; reason: string | null }
    >;
  }

  function makeMockPluginRegistry(
    plugins: MockPlugin[] = [],
  ) {
    return {
      getAll: () => plugins,
      get: (id: string) => plugins.find((p) => p.id === id),
    } as unknown as VehiclePluginRegistry;
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  let service: VehicleService;
  let db: AppDatabase;
  let mgr: VehicleManager;
  let registry: VehiclePluginRegistry;

  beforeEach(() => {
    db = makeMockDb({}, [VEHICLE_ROW]);
    mgr = makeMockVehicleManager();
    registry = makeMockPluginRegistry();
    service = new VehicleService(
      db,
      mgr,
      registry,
      new TypedEventEmitter(),
      testLogger,
    );
  });

  // =========================================================================
  // getPluginSummaries
  // =========================================================================

  describe("getPluginSummaries", () => {
    it("returns configured=true when a vehicle matches the plugin id", async () => {
      const plugins: MockPlugin[] = [{
        id: "tesla",
        displayName: "Tesla",
        settingsComponentKey: "TeslaSettings",
        getRouter: () => null,
      }];
      registry = makeMockPluginRegistry(plugins);
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.getPluginSummaries();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "tesla",
        displayName: "Tesla",
        configured: true,
        settingsComponentKey: "TeslaSettings",
      });
    });

    it("returns configured=false when no vehicles match the plugin id", async () => {
      db = makeMockDb({}, []);
      const plugins: MockPlugin[] = [{
        id: "tesla",
        displayName: "Tesla",
        settingsComponentKey: null,
        getRouter: () => null,
      }];
      registry = makeMockPluginRegistry(plugins);
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.getPluginSummaries();
      expect(result[0].configured).toBe(false);
    });

    it("returns multiple plugins with correct status", async () => {
      const plugins: MockPlugin[] = [
        {
          id: "tesla",
          displayName: "Tesla",
          settingsComponentKey: "TeslaSettings",
          getRouter: () => null,
        },
        {
          id: "simulated",
          displayName: "Simulated",
          settingsComponentKey: null,
          getRouter: () => null,
        },
      ];
      registry = makeMockPluginRegistry(plugins);
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.getPluginSummaries();
      expect(result).toHaveLength(2);
      // tesla has VEHICLE_ROW; simulated has none
      expect(result[0].configured).toBe(true);
      expect(result[1].configured).toBe(false);
    });
  });

  // =========================================================================
  // getCommandStatus
  // =========================================================================

  describe("getCommandStatus", () => {
    it("returns default when vehicle not found", async () => {
      db = makeMockDb({}, []);
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.getCommandStatus("UNKNOWN");
      expect(result).toEqual({ commandsDisabled: false, reason: null });
    });

    it("returns default when plugin not found in registry", async () => {
      const result = await service.getCommandStatus("v1");
      expect(result).toEqual({ commandsDisabled: false, reason: null });
    });

    it("returns the plugin's command status", async () => {
      const plugins: MockPlugin[] = [{
        id: "tesla",
        displayName: "Tesla",
        settingsComponentKey: null,
        getRouter: () => null,
        getCommandStatus: () =>
          Promise.resolve({ commandsDisabled: true, reason: "tokens expired" }),
      }];
      registry = makeMockPluginRegistry(plugins);
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.getCommandStatus("v1");
      expect(result).toEqual({
        commandsDisabled: true,
        reason: "tokens expired",
      });
    });
  });

  // =========================================================================
  // getVehicleOrThrow
  // =========================================================================

  describe("getVehicleOrThrow", () => {
    it("returns vehicle when found", async () => {
      const result = await service.getVehicleOrThrow("v1");
      expect(result.id).toBe("v1");
    });

    it("throws NOT_FOUND when vehicle does not exist", async () => {
      try {
        await service.getVehicleOrThrow("MISSING");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).code).toBe("NOT_FOUND");
      }
    });
  });

  // =========================================================================
  // listVehicles
  // =========================================================================

  describe("listVehicles", () => {
    it("returns vehicles with state, location, and no error", async () => {
      const stateWithLocation = {
        ...CHARGE_STATE,
        latitude: 1,
        longitude: 2,
      };
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(stateWithLocation),
        getVehicleError: () => null,
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.listVehicles();
      expect(result).toHaveLength(1);
      expect(result[0].state).toBe(stateWithLocation);
      expect(result[0].lastLocation).toEqual({ latitude: 1, longitude: 2 });
      expect(result[0].lastError).toBe(null);
      expect(result[0].lastErrorAt).toBe(null);
    });

    it("returns null location when state has no lat/lng", async () => {
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        getVehicleError: () => null,
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.listVehicles();
      expect(result[0].lastLocation).toBeNull();
    });

    it("returns vehicles with error details when error exists", async () => {
      const errorAt = new Date().toISOString();
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(null),
        getVehicleError: () => ({ message: "API down", at: errorAt }),
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.listVehicles();
      expect(result[0].lastError).toBe("API down");
      expect(result[0].lastErrorAt).toBe(errorAt);
    });
  });

  // =========================================================================
  // createVehicle
  // =========================================================================

  describe("createVehicle", () => {
    it("creates vehicle with defaults and registers with manager", async () => {
      db = makeMockDb({}, []);
      let addedRow: VehicleRow | undefined;
      mgr = makeMockVehicleManager({
        addVehicle: (row: VehicleRow) => {
          addedRow = row;
          return Promise.resolve();
        },
      });
      const upserted: VehicleRow[] = [];
      db.upsertVehicle = (row: VehicleRow) => {
        upserted.push(row);
        return Promise.resolve();
      };
      db.getVehicle = (id: string) =>
        Promise.resolve(upserted.find((v) => v.id === id) ?? null);
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.createVehicle({
        id: "v2",
        name: "New Car",
        adapterType: "tesla",
      });
      expect(result.success).toBe(true);
      expect(result.vehicle.priority).toBe(1);
      expect(result.vehicle.config).toBe("{}");
      expect(result.vehicle.mode).toBe("auto");
      expect(addedRow).toBeDefined();
    });

    it("creates vehicle with explicit priority, config, and mode", async () => {
      db = makeMockDb({}, []);
      const upserted: VehicleRow[] = [];
      db.upsertVehicle = (row: VehicleRow) => {
        upserted.push(row);
        return Promise.resolve();
      };
      db.getVehicle = (id: string) =>
        Promise.resolve(upserted.find((v) => v.id === id) ?? null);
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.createVehicle({
        id: "v2",
        name: "Custom",
        adapterType: "simulated",
        priority: 5,
        config: '{"key":"val"}',
        mode: "charge_now",
      });
      expect(result.vehicle.priority).toBe(5);
      expect(result.vehicle.config).toBe('{"key":"val"}');
      expect(result.vehicle.mode).toBe("charge_now");
    });

    it("throws CONFLICT when vehicle already exists", async () => {
      try {
        await service.createVehicle({
          id: "v1",
          name: "Duplicate",
          adapterType: "tesla",
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).code).toBe("CONFLICT");
      }
    });

    it("logs warning when addVehicle throws", async () => {
      db = makeMockDb({}, []);
      const upserted: VehicleRow[] = [];
      db.upsertVehicle = (row: VehicleRow) => {
        upserted.push(row);
        return Promise.resolve();
      };
      db.getVehicle = (id: string) =>
        Promise.resolve(upserted.find((v) => v.id === id) ?? null);
      mgr = makeMockVehicleManager({
        addVehicle: () => Promise.reject(new Error("adapter init failed")),
      });
      const warnLogger = new Logger("VehicleServiceTest", "warn");
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        warnLogger,
      );

      const result = await service.createVehicle({
        id: "v2",
        name: "Failing",
        adapterType: "tesla",
      });
      expect(result.success).toBe(true);
    });

    it("skips addVehicle when getVehicle returns null after upsert", async () => {
      db = makeMockDb({}, []);
      db.upsertVehicle = () => Promise.resolve();
      db.getVehicle = () => Promise.resolve(null);
      let addCalled = false;
      mgr = makeMockVehicleManager({
        addVehicle: () => {
          addCalled = true;
          return Promise.resolve();
        },
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.createVehicle({
        id: "v2",
        name: "Ghost",
        adapterType: "tesla",
      });
      expect(result.success).toBe(true);
      expect(addCalled).toBe(false);
    });
  });

  // =========================================================================
  // deleteVehicle
  // =========================================================================

  describe("deleteVehicle", () => {
    it("deletes vehicle and all related data", async () => {
      const deletedIds: string[] = [];
      mgr = makeMockVehicleManager({
        deleteVehicle: (id: string) => {
          deletedIds.push(id);
          return Promise.resolve();
        },
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.deleteVehicle("v1");
      expect(result).toEqual({ success: true });
      expect(deletedIds).toEqual(["v1"]);
    });

    it("throws NOT_FOUND when vehicle missing", async () => {
      try {
        await service.deleteVehicle("MISSING");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).code).toBe("NOT_FOUND");
      }
    });
  });

  // =========================================================================
  // setMode
  // =========================================================================

  describe("setMode", () => {
    it("updates mode", async () => {
      let modeSet: string | undefined;
      db.updateVehicleMode = (_id: string, mode: string) => {
        modeSet = mode;
        return Promise.resolve();
      };
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.setMode("v1", "auto");
      expect(result).toEqual({ success: true, mode: "auto" });
      expect(modeSet).toBe("auto");
    });

    it("charge_now immediately starts charging at max amps", async () => {
      let startedAt:
        | { vehicleId: string; amps: number; origin: string }
        | undefined;
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        startChargingAt: (
          vehicleId: string,
          amps: number,
          ctx: { origin: string },
        ) => {
          startedAt = { vehicleId, amps, origin: ctx.origin };
          return Promise.resolve({ success: true });
        },
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.setMode("v1", "charge_now");
      expect(result).toEqual({ success: true, mode: "charge_now" });
      expect(startedAt).toBeDefined();
      expect(startedAt?.vehicleId).toBe("v1");
      expect(startedAt?.amps).toBe(CHARGE_STATE.chargeAmpsMax);
      expect(startedAt?.origin).toBe("user:charge-now");
    });

    it("charge_now skips immediate start when no state available", async () => {
      let startCalled = false;
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(null),
        startChargingAt: () => {
          startCalled = true;
          return Promise.resolve({ success: true });
        },
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.setMode("v1", "charge_now");
      expect(result).toEqual({ success: true, mode: "charge_now" });
      expect(startCalled).toBe(false);
    });
  });

  // =========================================================================
  // setPriority
  // =========================================================================

  describe("setPriority", () => {
    it("updates priority", async () => {
      let prioritySet: number | undefined;
      db.updateVehiclePriority = (_id: string, p: number) => {
        prioritySet = p;
        return Promise.resolve();
      };
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.setPriority("v1", 3);
      expect(result).toEqual({ success: true, priority: 3 });
      expect(prioritySet).toBe(3);
    });
  });

  // =========================================================================
  // executeCommand
  // =========================================================================

  describe("executeCommand", () => {
    it("executes start command via vehicleManager.startChargingAt", async () => {
      let startCalled = false;
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        startChargingAt: (
          _id: string,
          _amps: number,
          _ctx: { origin: string },
        ) => {
          startCalled = true;
          return Promise.resolve({ success: true, state: CHARGE_STATE });
        },
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.executeCommand("v1", "start");
      expect(result.success).toBe(true);
      expect(result.state).toBe(CHARGE_STATE);
      expect(startCalled).toBe(true);
    });

    it("executes stop command and sets mode to stop", async () => {
      let stopCalled = false;
      let modeSet: string | null = null;
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        stopCharging: () => {
          stopCalled = true;
          return Promise.resolve({ success: true, state: CHARGE_STATE });
        },
      });
      db = makeMockDb({
        updateVehicleMode: (_id: string, mode: string) => {
          modeSet = mode;
          return Promise.resolve();
        },
      }, [VEHICLE_ROW]);
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.executeCommand("v1", "stop");
      expect(result.success).toBe(true);
      expect(stopCalled).toBe(true);
      expect(modeSet).toBe("stop");
    });

    it("executes wake command via vehicleManager.requestState with forceRefresh", async () => {
      let wakeContext: { forceRefresh?: boolean } | undefined;
      mgr = makeMockVehicleManager({
        requestState: (_id: string, ctx) => {
          wakeContext = ctx;
          return Promise.resolve(CHARGE_STATE);
        },
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.executeCommand("v1", "wake");
      expect(result.success).toBe(true);
      expect(result.state).toBe(CHARGE_STATE);
      expect(wakeContext?.forceRefresh).toBe(true);
    });

    it("wraps Error in ServiceError on command failure", async () => {
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        startChargingAt: () => Promise.reject(new Error("API error")),
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      try {
        await service.executeCommand("v1", "start");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).code).toBe("INTERNAL_SERVER_ERROR");
        expect((err as ServiceError).message).toBe("API error");
      }
    });

    it("wraps non-Error in ServiceError with 'Command failed'", async () => {
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        startChargingAt: () => Promise.reject("string error"),
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      try {
        await service.executeCommand("v1", "start");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).message).toBe("Command failed");
      }
    });
  });

  // =========================================================================
  // setAmps
  // =========================================================================

  describe("setAmps", () => {
    it("sets amps via vehicleManager.startChargingAt", async () => {
      let ampsSet: number | undefined;
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        startChargingAt: (_id: string, amps: number) => {
          ampsSet = amps;
          return Promise.resolve({ success: true, state: CHARGE_STATE });
        },
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.setAmps("v1", 10);
      expect(result.success).toBe(true);
      expect(result.state).toBe(CHARGE_STATE);
      expect(ampsSet).toBe(10);
    });

    it("wraps Error in ServiceError on failure", async () => {
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        startChargingAt: () => Promise.reject(new Error("amps error")),
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      try {
        await service.setAmps("v1", 10);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).message).toBe("amps error");
      }
    });

    it("wraps non-Error in ServiceError with 'Command failed'", async () => {
      mgr = makeMockVehicleManager({
        getState: () => Promise.resolve(CHARGE_STATE),
        startChargingAt: () => Promise.reject(42),
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      try {
        await service.setAmps("v1", 10);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).message).toBe("Command failed");
      }
    });
  });

  describe("refreshState", () => {
    it("force-refreshes vehicle state via requestState", async () => {
      let refreshContext: { forceRefresh?: boolean } | undefined;
      mgr = makeMockVehicleManager({
        requestState: (_id: string, ctx) => {
          refreshContext = ctx;
          return Promise.resolve(CHARGE_STATE);
        },
      });
      service = new VehicleService(
        db,
        mgr,
        registry,
        new TypedEventEmitter(),
        testLogger,
      );

      const result = await service.refreshState("v1");
      expect(result.state).toBe(CHARGE_STATE);
      expect(refreshContext?.forceRefresh).toBe(true);
    });

    it("throws NOT_FOUND for missing vehicle", async () => {
      try {
        await service.refreshState("MISSING");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).code).toBe("NOT_FOUND");
      }
    });
  });
});
