import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type {
  CallContext,
  ChargerInfo,
  ChargerState,
  VehicleChargeState,
} from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow, VehicleRow } from "../db/types.ts";
import { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import type { ChargerMiddleware, ChargerPlugin } from "@chargeha/plugins/types";
import type { VehicleManager } from "./VehicleManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { ChargingPointManager } from "./ChargingPointManager.ts";
import { Logger } from "../lib/Logger.ts";
import { MockEventEmitter } from "../test-helpers/MockEventEmitter.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

/** Controllable ChargerMiddleware stub. Mirrors MockMiddleware's shape for
 *  vehicles — tracks calls, lets tests drive responses via mutable fields. */
class StubChargerMiddleware implements ChargerMiddleware {
  requestStateCalls: CallContext[] = [];
  startCalls: string[] = [];
  stopCalls: string[] = [];
  setAmpsCalls: Array<{ amps: number; origin: string }> = [];
  shutdownCalls = 0;
  nextState: ChargerState | null;
  info: ChargerInfo;
  startResult = true;
  stopResult = true;
  setAmpsResult = true;
  private cached: ChargerState | null = null;

  constructor(nextState: ChargerState | null, info: ChargerInfo) {
    this.nextState = nextState;
    this.info = info;
  }

  requestState(ctx: CallContext): Promise<ChargerState | null> {
    this.requestStateCalls.push(ctx);
    this.cached = this.nextState ? { ...this.nextState } : null;
    return Promise.resolve(this.cached);
  }

  getCachedState(): ChargerState | null {
    return this.cached;
  }

  /** Seed the cache directly, bypassing requestState — used to test that
   *  getState never triggers a device call. */
  seedCache(state: ChargerState): void {
    this.cached = { ...state };
  }

  getChargerInfo(_ctx: CallContext): Promise<ChargerInfo> {
    return Promise.resolve(this.info);
  }

  startCharging(ctx: CallContext): Promise<boolean> {
    this.startCalls.push(ctx.origin);
    return Promise.resolve(this.startResult);
  }

  stopCharging(ctx: CallContext): Promise<boolean> {
    this.stopCalls.push(ctx.origin);
    return Promise.resolve(this.stopResult);
  }

  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    this.setAmpsCalls.push({ amps, origin: ctx.origin });
    return Promise.resolve(this.setAmpsResult);
  }

  shutdown(): Promise<void> {
    this.shutdownCalls++;
    return Promise.resolve();
  }
}

describe("ChargingPointManager", () => {
  const registerChargerPlugin = (
    registry: ChargerPluginRegistry,
    middlewares: Map<string, StubChargerMiddleware>,
    type: string,
    displayName: string,
    info: ChargerInfo,
  ): void => {
    registry.register(throwingMock<ChargerPlugin>("ChargerPlugin", {
      id: type,
      displayName,
      createChargerMiddleware: (row: ChargerRow) => {
        const mw = new StubChargerMiddleware(null, info);
        middlewares.set(row.id, mw);
        return Promise.resolve(mw);
      },
    }));
  };

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const testLogger = new Logger("ChargingPointManager", "error");

  const CHARGER_TYPE = "sim";

  const INFO: ChargerInfo = {
    id: CHARGER_TYPE,
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

  const ROW: ChargerRow = {
    id: "charger-1",
    name: "Test Charger",
    chargerAdapterType: CHARGER_TYPE,
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  const STATE: ChargerState = {
    chargerId: "charger-1",
    isCharging: false,
    isPluggedIn: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 6,
    chargePowerKw: 0,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 0,
    status: "available",
    statusDetail: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const CTX: CallContext = { origin: "test", traceId: "test" };

  const VEHICLE_STATE: VehicleChargeState = {
    vehicleId: "VEH1",
    batteryLevel: 50,
    chargeLimit: 80,
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
    chargePortOpen: false,
    vehicleName: "Vehicle",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    latitude: null,
    longitude: null,
    isHome: null,
  };

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
  let chargerRows: ChargerRow[];
  let vehicleRows: VehicleRow[];
  let deletedIds: string[];
  let resequenceCallCount: number;
  let registry: ChargerPluginRegistry;
  let middlewares: Map<string, StubChargerMiddleware>;
  let emitter: MockEventEmitter;
  let vehicleStates: Map<string, VehicleChargeState>;
  let vehicleManager: VehicleManager;
  let poller: EnergyPoller;
  let gridVoltage: number;
  let configService: ConfigService;
  let manager: ChargingPointManager;

  beforeEach(() => {
    chargerRows = [];
    vehicleRows = [];
    deletedIds = [];
    resequenceCallCount = 0;
    db = throwingMock<AppDatabase>("AppDatabase", {
      getChargers: () => Promise.resolve(chargerRows),
      getVehicles: () => Promise.resolve(vehicleRows),
      upsertCharger: (input) => {
        chargerRows = [
          ...chargerRows.filter((r) => r.id !== input.id),
          {
            id: input.id,
            name: input.name,
            chargerAdapterType: input.chargerAdapterType,
            chargerConfig: input.chargerConfig ?? "{}",
            mode: input.mode ?? "auto",
            priority: input.priority ?? chargerRows.length + 1,
            vehicleId: input.vehicleId ?? null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ];
        return Promise.resolve();
      },
      deleteCharger: (id) => {
        deletedIds = [...deletedIds, id];
        chargerRows = chargerRows.filter((r) => r.id !== id);
        return Promise.resolve();
      },
      resequenceChargerPriorities: () => {
        resequenceCallCount++;
        return Promise.resolve();
      },
    });

    middlewares = new Map();
    registry = new ChargerPluginRegistry();
    registerChargerPlugin(
      registry,
      middlewares,
      CHARGER_TYPE,
      "Simulated Charger",
      INFO,
    );

    emitter = new MockEventEmitter();

    vehicleStates = new Map();
    vehicleManager = throwingMock<VehicleManager>("VehicleManager", {
      getAllStates: () => Promise.resolve(vehicleStates),
    });

    poller = throwingMock<EnergyPoller>("EnergyPoller", {
      tryGetRealtimeSnapshot: () => null,
    });

    gridVoltage = 230;
    configService = throwingMock<ConfigService>("ConfigService", {
      getSolar: () => Promise.resolve({ ...SOLAR_DEFAULTS, gridVoltage }),
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

  describe("addCharger", () => {
    it("registers via plugin.createChargerMiddleware and emits chargers_changed", async () => {
      await manager.addCharger(ROW);

      expect(middlewares.has(ROW.id)).toBe(true);
      expect(
        emitter.events.some((e) => e.type === "chargers_changed"),
      ).toBe(true);
    });

    it("logs and skips an unknown plugin type", async () => {
      const row = {
        ...ROW,
        id: "charger-unknown",
        chargerAdapterType: "unknown-vendor",
      };

      await manager.addCharger(row);

      expect(manager.getState(row.id)).toBeNull();
      expect(
        emitter.events.some((e) => e.type === "chargers_changed"),
      ).toBe(false);
    });
  });

  describe("deleteCharger", () => {
    it("shuts middleware down, deletes row, resequences, emits", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      emitter.events.length = 0;

      await manager.deleteCharger(ROW.id);

      expect(mw.shutdownCalls).toBe(1);
      expect(deletedIds).toContain(ROW.id);
      expect(resequenceCallCount).toBe(1);
      expect(
        emitter.events.filter((e) => e.type === "chargers_changed"),
      ).toHaveLength(1);
      expect(manager.getState(ROW.id)).toBeNull();
    });
  });

  describe("requestState", () => {
    it("does not derive amps while cachedGridVoltage is null pre-init", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.nextState = { ...STATE, chargeAmps: null, chargePowerKw: 2.3 };

      const state = await manager.requestState(ROW.id, CTX);

      assertExists(state);
      expect(state.chargeAmps).toBeNull();
    });

    it("derives amps from watts via resolveVoltage using cachedGridVoltage", async () => {
      await manager.addCharger(ROW);
      gridVoltage = 230;
      await manager.init();
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.nextState = {
        ...STATE,
        chargeAmps: null,
        chargePowerKw: 2.3,
        chargerVoltage: null,
      };

      const state = await manager.requestState(ROW.id, CTX);

      assertExists(state);
      expect(state.chargeAmps).toBe(10);
    });

    it("emits charger_update only when lastUpdated changes", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);

      mw.nextState = { ...STATE, lastUpdated: "t1" };
      await manager.requestState(ROW.id, CTX);
      await manager.requestState(ROW.id, CTX);

      expect(
        emitter.events.filter((e) => e.type === "charger_update"),
      ).toHaveLength(1);

      mw.nextState = { ...STATE, lastUpdated: "t2" };
      await manager.requestState(ROW.id, CTX);

      expect(
        emitter.events.filter((e) => e.type === "charger_update"),
      ).toHaveLength(2);
    });
  });

  describe("getState", () => {
    it("serves enriched cache without device calls", async () => {
      await manager.addCharger(ROW);
      gridVoltage = 230;
      await manager.init();
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.seedCache({
        ...STATE,
        chargeAmps: null,
        chargePowerKw: 2.3,
        chargerVoltage: null,
      });

      const state = manager.getState(ROW.id);

      assertExists(state);
      expect(state.chargeAmps).toBe(10);
      expect(mw.requestStateCalls).toHaveLength(0);
    });
  });

  describe("startChargingAt", () => {
    it("clamps amps to [min, max]", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);

      await manager.startChargingAt(
        ROW.id,
        999,
        CTX,
        { ...STATE, isCharging: false, chargeAmps: 0 },
      );

      expect(mw.setAmpsCalls.at(-1)?.amps).toBe(32);
    });

    it("skips setChargeAmps for controlMode switch", async () => {
      const row = {
        ...ROW,
        id: "charger-switch",
        chargerAdapterType: "switch-type",
      };
      registerChargerPlugin(
        registry,
        middlewares,
        "switch-type",
        "Switch Charger",
        {
          ...INFO,
          controlMode: "switch",
        },
      );
      await manager.addCharger(row);
      const mw = middlewares.get(row.id);
      assertExists(mw);

      const result = await manager.startChargingAt(
        row.id,
        16,
        CTX,
        { ...STATE, isCharging: false, chargeAmps: 0 },
      );

      expect(result.success).toBe(true);
      expect(mw.setAmpsCalls).toHaveLength(0);
      expect(mw.startCalls).toHaveLength(1);
    });

    it("skips setChargeAmps and start when already at target amps", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);

      await manager.startChargingAt(
        ROW.id,
        16,
        CTX,
        { ...STATE, isCharging: true, chargeAmps: 16 },
      );

      expect(mw.setAmpsCalls).toHaveLength(0);
      expect(mw.startCalls).toHaveLength(0);
    });

    it("applies command backoff on failure, bypassed by force", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      const startState = { ...STATE, isCharging: false, chargeAmps: 0 };

      mw.setAmpsResult = false;
      await manager.startChargingAt(ROW.id, 16, CTX, startState);

      mw.setAmpsResult = true;
      const blocked = await manager.startChargingAt(
        ROW.id,
        16,
        CTX,
        startState,
      );
      expect(blocked.success).toBe(false);
      expect(blocked.error).toBe("Command backoff active");

      const forced = await manager.startChargingAt(
        ROW.id,
        16,
        CTX,
        startState,
        { force: true },
      );
      expect(forced.success).toBe(true);
    });
  });

  describe("stopCharging", () => {
    it("no-ops when not charging", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);

      const result = await manager.stopCharging(
        ROW.id,
        CTX,
        { ...STATE, isCharging: false },
      );

      expect(result.success).toBe(true);
      expect(mw.stopCalls).toHaveLength(0);
    });
  });

  describe("ensureCharger", () => {
    it("is idempotent per adapter type and names the row from plugin displayName", async () => {
      await manager.ensureCharger(CHARGER_TYPE);
      await manager.ensureCharger(CHARGER_TYPE);

      expect(chargerRows).toHaveLength(1);
      expect(chargerRows[0].chargerAdapterType).toBe(CHARGER_TYPE);
      expect(chargerRows[0].name).toBe("Simulated Charger");
    });
  });

  describe("init", () => {
    it("loads grid voltage and registers existing charger rows", async () => {
      chargerRows = [ROW];
      gridVoltage = 225;

      await manager.init();

      expect(middlewares.has(ROW.id)).toBe(true);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.seedCache({
        ...STATE,
        chargeAmps: null,
        chargePowerKw: 2.25,
        chargerVoltage: null,
      });
      expect(manager.getState(ROW.id)?.chargeAmps).toBe(10);
    });

    it("reloads grid voltage on config_changed", async () => {
      chargerRows = [ROW];
      gridVoltage = 225;
      await manager.init();

      gridVoltage = 220;
      emitter.emit("config_changed", { key: "other-plugin.some_key" });
      await tick();

      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.seedCache({
        ...STATE,
        chargeAmps: null,
        chargePowerKw: 2.2,
        chargerVoltage: null,
      });
      expect(manager.getState(ROW.id)?.chargeAmps).toBe(10);
    });

    it("rebuilds middlewares for the matching plugin prefix only", async () => {
      chargerRows = [ROW];
      await manager.init();
      const originalMw = middlewares.get(ROW.id);
      assertExists(originalMw);

      emitter.emit("config_changed", { key: "other-plugin.some_key" });
      await tick();
      expect(originalMw.shutdownCalls).toBe(0);

      emitter.emit("config_changed", { key: `${CHARGER_TYPE}.some_key` });
      await tick();
      expect(originalMw.shutdownCalls).toBe(1);
      expect(middlewares.get(ROW.id)).not.toBe(originalMw);
    });
  });

  describe("migrateVehiclesToChargers", () => {
    const vehicle = (id: string, adapterType: string): VehicleRow => ({
      id,
      name: `Car ${id}`,
      adapterType,
      priority: 2,
      config: "{}",
      mode: "charge_now",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    it("creates linked rows only for charger-role vehicle plugins", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      vehicleRows = [vehicle("VIN1", "tesla"), vehicle("VIN2", "dataonly")];

      await manager.init();

      const migrated = chargerRows.filter((r) => r.vehicleId !== null);
      expect(migrated.length).toBe(1);
      expect(migrated[0].vehicleId).toBe("VIN1");
      expect(migrated[0].chargerAdapterType).toBe("tesla");
      expect(migrated[0].mode).toBe("charge_now");
      expect(migrated[0].priority).toBe(2);
    });

    it("does nothing when a standalone smart charger owns control", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      registerChargerPlugin(registry, middlewares, "tapo", "Tapo", INFO);
      chargerRows = [{ ...ROW, chargerAdapterType: "tapo", vehicleId: null }];
      vehicleRows = [vehicle("VIN1", "tesla")];

      await manager.init();

      expect(chargerRows.length).toBe(1);
    });

    it("is idempotent across boots", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      vehicleRows = [vehicle("VIN1", "tesla")];

      await manager.init();
      const afterFirst = chargerRows.length;
      await manager.init();

      expect(chargerRows.length).toBe(afterFirst);
    });
  });

  describe("resolveVehicleId", () => {
    it("returns the linked vehicle id without inspecting state", async () => {
      const row = { ...ROW, id: "charger-linked", vehicleId: "VEH1" };
      await manager.addCharger(row);

      const vehicleId = await manager.resolveVehicleId(row.id);

      expect(vehicleId).toBe("VEH1");
    });

    it("infers the single plugged-in vehicle when unlinked and charging", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.seedCache({ ...STATE, isCharging: true });
      vehicleStates = new Map([
        ["VEH1", { ...VEHICLE_STATE, vehicleId: "VEH1", isPluggedIn: true }],
        ["VEH2", { ...VEHICLE_STATE, vehicleId: "VEH2", isPluggedIn: false }],
      ]);

      const vehicleId = await manager.resolveVehicleId(ROW.id);

      expect(vehicleId).toBe("VEH1");
    });

    it("refuses to guess when multiple vehicles are plugged in", async () => {
      await manager.addCharger(ROW);
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.seedCache({ ...STATE, isCharging: true });
      vehicleStates = new Map([
        ["VEH1", { ...VEHICLE_STATE, vehicleId: "VEH1", isPluggedIn: true }],
        ["VEH2", { ...VEHICLE_STATE, vehicleId: "VEH2", isPluggedIn: true }],
      ]);

      const vehicleId = await manager.resolveVehicleId(ROW.id);

      expect(vehicleId).toBeNull();
    });
  });
});
