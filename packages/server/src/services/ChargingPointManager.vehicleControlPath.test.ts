import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { CallContext, ChargerInfo, ChargerState } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow, VehicleRow } from "../db/types.ts";
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

/** Controllable ChargerMiddleware stub — same shape as the sibling test
 *  file's; kept local rather than shared so each test file is self-contained
 *  and can be read on its own. */
class StubChargerMiddleware implements ChargerMiddleware {
  startCalls: string[] = [];
  nextState: ChargerState | null;
  info: ChargerInfo;
  private cached: ChargerState | null = null;

  constructor(nextState: ChargerState | null, info: ChargerInfo) {
    this.nextState = nextState;
    this.info = info;
  }

  requestState(_ctx: CallContext): Promise<ChargerState | null> {
    this.cached = this.nextState ? { ...this.nextState } : null;
    return Promise.resolve(this.cached);
  }

  getCachedState(): ChargerState | null {
    return this.cached;
  }

  getChargerInfo(_ctx: CallContext): Promise<ChargerInfo> {
    return Promise.resolve(this.info);
  }

  startCharging(ctx: CallContext): Promise<boolean> {
    this.startCalls.push(ctx.origin);
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

describe("ChargingPointManager vehicle control path", () => {
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
      createChargerMiddleware: (
        row: ChargerRow,
        _resolved: ChargerRowConfig,
      ) => {
        const mw = new StubChargerMiddleware(null, info);
        middlewares.set(row.id, mw);
        return Promise.resolve(mw);
      },
    }));
  };

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
    kind: "smart",
    active: true,
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
  let registry: ChargerPluginRegistry;
  let middlewares: Map<string, StubChargerMiddleware>;
  let emitter: MockEventEmitter;
  let manager: ChargingPointManager;

  beforeEach(() => {
    chargerRows = [];
    vehicleRows = [];
    deletedIds = [];
    db = throwingMock<AppDatabase>("AppDatabase", {
      getChargers: () => Promise.resolve(chargerRows),
      getVehicles: () => Promise.resolve(vehicleRows),
      getChargerConfig: () => Promise.resolve({}),
      getChargerSecrets: () => Promise.resolve({}),
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
            kind: input.kind ?? "smart",
            active: input.active ?? true,
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
      resequenceChargerPriorities: () => Promise.resolve(),
      updateChargerActive: (id, active) => {
        chargerRows = chargerRows.map((r) =>
          r.id === id ? { ...r, active } : r
        );
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
    const vehicleManager = throwingMock<VehicleManager>("VehicleManager", {
      getAllStates: () => Promise.resolve(new Map()),
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

  describe("ensureVehicleChargingPoint", () => {
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

    it("derives the id from the vehicle so it survives deactivation", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      await manager.init();

      await manager.ensureVehicleChargingPoint(vehicle("VIN1", "tesla"));

      expect(chargerRows.length).toBe(1);
      expect(chargerRows[0].id).toBe("cp-VIN1");
      expect(chargerRows[0].kind).toBe("vehicle_api");
      expect(chargerRows[0].mode).toBe("charge_now");
      expect(chargerRows[0].priority).toBe(2);
    });

    it("creates nothing for a plugin with no charger role", async () => {
      await manager.init();

      await manager.ensureVehicleChargingPoint(vehicle("VIN2", "dataonly"));

      expect(chargerRows.length).toBe(0);
    });

    it("creates the row inactive, not skipped, while a smart charger owns control", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      registerChargerPlugin(registry, middlewares, "tapo", "Tapo", INFO);
      chargerRows = [{ ...ROW, chargerAdapterType: "tapo", kind: "smart" }];
      await manager.init();

      await manager.ensureVehicleChargingPoint(vehicle("VIN1", "tesla"));

      const point = chargerRows.find((r) => r.kind === "vehicle_api");
      expect(chargerRows.length).toBe(2);
      expect(point?.active).toBe(false);
      expect(middlewares.has("cp-VIN1")).toBe(false);
    });

    it("creates the row active when no smart charger exists yet", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      await manager.init();

      await manager.ensureVehicleChargingPoint(vehicle("VIN1", "tesla"));

      const point = chargerRows.find((r) => r.kind === "vehicle_api");
      expect(point?.active).toBe(true);
      expect(middlewares.has("cp-VIN1")).toBe(true);
    });

    it("is idempotent", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      await manager.init();

      await manager.ensureVehicleChargingPoint(vehicle("VIN1", "tesla"));
      await manager.ensureVehicleChargingPoint(vehicle("VIN1", "tesla"));

      expect(chargerRows.length).toBe(1);
    });
  });

  describe("syncVehicleChargingPoints", () => {
    const vehicle = (id: string, adapterType: string): VehicleRow => ({
      id,
      name: `Car ${id}`,
      adapterType,
      priority: 1,
      config: "{}",
      mode: "auto",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    it("drops the charging point when its vehicle is deleted", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      vehicleRows = [vehicle("VIN1", "tesla")];
      await manager.init();
      await manager.ensureVehicleChargingPoint(vehicle("VIN1", "tesla"));
      expect(chargerRows.length).toBe(1);

      vehicleRows = [];
      await manager.syncVehicleChargingPoints();

      expect(chargerRows.filter((r) => r.vehicleId !== null).length).toBe(0);
    });

    it("does not create points for newly added vehicles", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      await manager.init();

      vehicleRows = [vehicle("VIN1", "tesla")];
      await manager.syncVehicleChargingPoints();

      expect(chargerRows.length).toBe(0);
    });
  });

  describe("control path switching", () => {
    const linkedRow = (vehicleId: string) => ({
      ...ROW,
      id: `cp-${vehicleId}`,
      chargerAdapterType: "tesla",
      vehicleId,
      kind: "vehicle_api" as const,
    });

    it("deactivates vehicle-API points when the first smart charger arrives", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      chargerRows = [linkedRow("VIN1")];
      await manager.init();

      await manager.createCharger({
        name: "Wallbox",
        chargerAdapterType: CHARGER_TYPE,
      });

      const linked = chargerRows.find((r) => r.vehicleId === "VIN1");
      expect(linked).toBeDefined();
      expect(linked?.active).toBe(false);
      expect(deletedIds).toEqual([]);
    });

    it("reactivates them when the last smart charger is removed", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      chargerRows = [linkedRow("VIN1")];
      await manager.init();
      const smart = await manager.createCharger({
        name: "Wallbox",
        chargerAdapterType: CHARGER_TYPE,
      });

      await manager.deleteCharger(smart.id);

      expect(chargerRows.find((r) => r.vehicleId === "VIN1")?.active).toBe(
        true,
      );
    });

    it("switches one vehicle without touching the others", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      chargerRows = [linkedRow("VIN1"), linkedRow("VIN2")];
      await manager.init();

      await manager.setVehicleApiControl("VIN1", false);

      expect(chargerRows.find((r) => r.vehicleId === "VIN1")?.active).toBe(
        false,
      );
      expect(chargerRows.find((r) => r.vehicleId === "VIN2")?.active).toBe(
        true,
      );
    });

    it("flipping the toggle off unregisters the point so it can no longer command the car", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      chargerRows = [linkedRow("VIN1")];
      await manager.init();
      const id = chargerRows[0].id;
      expect(manager.isControllable(id)).toBe(true);

      await manager.setVehicleApiControl("VIN1", false);

      expect(manager.isControllable(id)).toBe(false);
      expect(manager.getState(id)).toBeNull();
    });

    it("flipping the toggle on registers an inactive point and lets it command the car", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      chargerRows = [{ ...linkedRow("VIN1"), active: false }];
      await manager.init();
      const id = chargerRows[0].id;
      expect(manager.isControllable(id)).toBe(false);

      await manager.setVehicleApiControl("VIN1", true);

      expect(manager.isControllable(id)).toBe(true);
      const mw = middlewares.get(id);
      assertExists(mw);
      const state = { ...STATE, chargerId: id, isCharging: false };
      await manager.startChargingAt(id, 16, CTX, state);
      expect(mw.startCalls).toHaveLength(1);
    });

    it("an inactive vehicle_api row never registers, so it cannot command the vehicle", async () => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      chargerRows = [{ ...linkedRow("VIN1"), active: false }];
      await manager.init();

      expect(middlewares.has(chargerRows[0].id)).toBe(false);
      expect(manager.getState(chargerRows[0].id)).toBeNull();
    });
  });
});
