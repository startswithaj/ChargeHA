import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type {
  CallContext,
  ChargerInfo,
  ChargerState,
  VehicleChargeState,
} from "@chargeha/shared";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow, VehicleRow } from "../db/types.ts";
import { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  ChargerRowConfig,
} from "@chargeha/shared/plugins";
import type { VehicleManager } from "./VehicleManager.ts";
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
  ampCalls: number[] = [];
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

  setChargeAmps(amps: number, _ctx: CallContext): Promise<boolean> {
    this.ampCalls.push(amps);
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
      onChargerRemoved: () => {},
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
  let vehicleStates: Map<string, VehicleChargeState>;
  let deletedIds: string[];
  let registry: ChargerPluginRegistry;
  let middlewares: Map<string, StubChargerMiddleware>;
  let emitter: MockEventEmitter;
  let manager: ChargingPointManager;

  beforeEach(() => {
    chargerRows = [];
    vehicleRows = [];
    vehicleStates = new Map();
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
      getAllStates: () => Promise.resolve(vehicleStates),
      loadIsUnmetered: () => false,
    });
    const configService = throwingMock<ConfigService>("ConfigService", {
      getSolar: () => Promise.resolve({ ...SOLAR_DEFAULTS }),
    });
    manager = new ChargingPointManager(
      db,
      registry,
      vehicleManager,
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

  /** With API control on, the car's own API owns the session and the smart
   *  charger it is plugged into must stop deciding — but must NOT be
   *  unregistered, or it stops passing current and stops reporting the meter
   *  reading everything else depends on. */
  describe("passive smart charger", () => {
    const apiPoint = (vehicleId: string, active = true): ChargerRow => ({
      ...ROW,
      id: `cp-${vehicleId}`,
      chargerAdapterType: "tesla",
      vehicleId,
      kind: "vehicle_api",
      active,
    });

    const plugged = (id: string, overrides = {}) =>
      buildVehicleChargeState({
        vehicleId: id,
        isPluggedIn: true,
        isHome: true,
        ...overrides,
      });

    /** Registers both plugins, boots, and polls the smart charger once so it
     *  has cached state to reason about. */
    const boot = async (): Promise<void> => {
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      await manager.init();
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.nextState = { ...STATE };
      await manager.requestState(ROW.id, CTX);
    };

    it("goes passive for a self-driven car plugged into it", async () => {
      chargerRows = [ROW, apiPoint("VIN1")];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      await boot();

      const path = await manager.getControlPath(ROW.id);

      expect(path.owner).toBe("vehicle_api");
      expect(path.passiveForVehicleId).toBe("VIN1");
    });

    it("keeps control when that car's API control is off", async () => {
      chargerRows = [ROW, apiPoint("VIN1", false)];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      await boot();

      const path = await manager.getControlPath(ROW.id);

      expect(path.owner).toBe("self");
      expect(path.passiveForVehicleId).toBeNull();
    });

    it("follows the toggle in both directions", async () => {
      chargerRows = [ROW, apiPoint("VIN1", false)];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      await boot();
      expect((await manager.getControlPath(ROW.id)).owner).toBe("self");

      await manager.setVehicleApiControl("VIN1", true);
      expect((await manager.getControlPath(ROW.id)).owner).toBe("vehicle_api");

      await manager.setVehicleApiControl("VIN1", false);
      expect((await manager.getControlPath(ROW.id)).owner).toBe("self");
    });

    // The household case: one API-controlled Tesla, one dumb second car. The
    // charger must keep working normally for the second car.
    it("keeps full control for a second, non-API car on the same charger", async () => {
      chargerRows = [ROW, apiPoint("VIN1")];
      vehicleStates = new Map([
        ["VIN1", plugged("VIN1")],
        ["VIN2", plugged("VIN2")],
      ]);
      await boot();

      const path = await manager.getControlPath(ROW.id);
      const resolution = await manager.resolveVehicle(ROW.id);

      expect(path.owner).toBe("self");
      expect(resolution.vehicleId).toBe("VIN2");
    });

    it("goes passive for an explicitly assigned self-driven car", async () => {
      chargerRows = [{ ...ROW, vehicleId: "VIN1" }, apiPoint("VIN1")];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      await boot();

      expect((await manager.getControlPath(ROW.id)).passiveForVehicleId).toBe(
        "VIN1",
      );
    });

    it("refuses to guess when two self-driven cars are plugged in", async () => {
      chargerRows = [ROW, apiPoint("VIN1"), apiPoint("VIN2")];
      vehicleStates = new Map([
        ["VIN1", plugged("VIN1")],
        ["VIN2", plugged("VIN2")],
      ]);
      await boot();

      expect((await manager.getControlPath(ROW.id)).owner).toBe("self");
    });

    it("holds the connector open at max amps, once", async () => {
      chargerRows = [ROW, apiPoint("VIN1")];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      await boot();
      const mw = middlewares.get(ROW.id);
      assertExists(mw);

      await manager.holdOpen(ROW.id, CTX);
      await manager.holdOpen(ROW.id, CTX);

      expect(mw.startCalls).toHaveLength(1);
      expect(mw.ampCalls).toEqual([32]);
    });

    it("does nothing while nothing is plugged in", async () => {
      chargerRows = [ROW, apiPoint("VIN1")];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      registerChargerPlugin(registry, middlewares, "tesla", "Tesla", INFO);
      await manager.init();
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.nextState = { ...STATE, isPluggedIn: false };
      await manager.requestState(ROW.id, CTX);

      await manager.holdOpen(ROW.id, CTX);

      expect(mw.startCalls).toHaveLength(0);
    });

    it("re-issues the hold after the cable is pulled and replugged", async () => {
      chargerRows = [ROW, apiPoint("VIN1")];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      await boot();
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      await manager.holdOpen(ROW.id, CTX);

      // Unplug, then replug — requestState is what detects the edge.
      mw.nextState = { ...STATE, isPluggedIn: false };
      await manager.requestState(ROW.id, CTX);
      mw.nextState = { ...STATE, isPluggedIn: true };
      await manager.requestState(ROW.id, CTX);
      await manager.holdOpen(ROW.id, CTX);

      expect(mw.startCalls).toHaveLength(2);
    });

    it("clears the hold when control comes back, so amps are re-decided", async () => {
      chargerRows = [ROW, apiPoint("VIN1")];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      await boot();
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      await manager.holdOpen(ROW.id, CTX);

      await manager.setVehicleApiControl("VIN1", false);
      // Reading the path is what observes the transition and drops the hold.
      expect((await manager.getControlPath(ROW.id)).owner).toBe("self");
      await manager.startChargingAt(ROW.id, 10, CTX, { ...STATE });

      expect(mw.ampCalls).toEqual([32, 10]);
    });

    it("exposes the control path on the charger list for the dashboard", async () => {
      chargerRows = [ROW, apiPoint("VIN1")];
      vehicleStates = new Map([["VIN1", plugged("VIN1")]]);
      await boot();

      const listed = await manager.getChargersWithState();
      const smart = listed.find((r) => r.id === ROW.id);

      expect(smart?.controlOwner).toBe("vehicle_api");
      expect(smart?.passiveForVehicleId).toBe("VIN1");
    });

    // One physical session, two reporters: the charger's meter and the car's
    // own API. Counting both turned 7kW of load into 14kW, and that figure
    // feeds the energy adapter and so every solar decision.
    it("counts a passive charger's session once, not twice", async () => {
      chargerRows = [ROW, apiPoint("VIN1")];
      vehicleStates = new Map([
        ["VIN1", plugged("VIN1", { isCharging: true, chargePowerKw: 7 })],
      ]);
      vehicleRows = [{
        id: "VIN1",
        name: "Car VIN1",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }];
      await boot();
      const mw = middlewares.get(ROW.id);
      assertExists(mw);
      mw.nextState = { ...STATE, isCharging: true, chargePowerKw: 7 };
      await manager.requestState(ROW.id, CTX);

      const load = await manager.getChargingLoadW();

      expect(load.meteredW).toBe(7000);
    });
  });
});
