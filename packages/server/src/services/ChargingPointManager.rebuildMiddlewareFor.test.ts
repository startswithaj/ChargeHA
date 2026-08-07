import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { CallContext, ChargerInfo, ChargerState } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
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

/** Controllable ChargerMiddleware stub — same shape as the sibling test
 *  file's; kept local rather than shared so each test file is self-contained
 *  and can be read on its own. */
class StubChargerMiddleware implements ChargerMiddleware {
  setAmpsCalls: Array<{ amps: number; origin: string }> = [];
  shutdownCalls = 0;
  nextState: ChargerState | null;
  info: ChargerInfo;
  setAmpsResult = true;
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

  startCharging(_ctx: CallContext): Promise<boolean> {
    return Promise.resolve(true);
  }

  stopCharging(_ctx: CallContext): Promise<boolean> {
    return Promise.resolve(true);
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

describe("ChargingPointManager.rebuildMiddlewareFor", () => {
  const registerChargerPlugin = (
    registry: ChargerPluginRegistry,
    middlewares: Map<string, StubChargerMiddleware>,
    type: string,
    displayName: string,
    info: ChargerInfo,
    onCreate?: (row: ChargerRow, resolved: ChargerRowConfig) => void,
  ): void => {
    registry.register(throwingMock<ChargerPlugin>("ChargerPlugin", {
      id: type,
      displayName,
      createChargerMiddleware: (
        row: ChargerRow,
        resolved: ChargerRowConfig,
      ) => {
        onCreate?.(row, resolved);
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
  let chargerConfigs: Map<string, Record<string, string>>;
  let registry: ChargerPluginRegistry;
  let middlewares: Map<string, StubChargerMiddleware>;
  let emitter: MockEventEmitter;
  let manager: ChargingPointManager;

  beforeEach(() => {
    chargerRows = [];
    chargerConfigs = new Map();
    db = throwingMock<AppDatabase>("AppDatabase", {
      getChargers: () => Promise.resolve(chargerRows),
      getVehicles: () => Promise.resolve([]),
      getChargerConfig: (id: string) =>
        Promise.resolve(chargerConfigs.get(id) ?? {}),
      getChargerSecrets: () => Promise.resolve({}),
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
    const vehicleManager = throwingMock<VehicleManager>("VehicleManager", {});
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

  it("registers a row that is not yet in the map — first save on a fresh charger", async () => {
    chargerRows = [ROW];

    await manager.rebuildMiddlewareFor(ROW.id);

    expect(middlewares.has(ROW.id)).toBe(true);
    expect(emitter.events.some((e) => e.type === "chargers_changed"))
      .toBe(true);
  });

  it("is a no-op for an id with no row — never throws", async () => {
    await manager.rebuildMiddlewareFor("does-not-exist");

    expect(middlewares.size).toBe(0);
  });

  it("shuts down the old middleware, clears lastCommandedAmps, emits chargers_changed", async () => {
    await manager.addCharger(ROW);
    const originalMw = middlewares.get(ROW.id);
    assertExists(originalMw);
    const notCharging = { ...STATE, isCharging: false, chargeAmps: 0 };
    await manager.startChargingAt(ROW.id, 16, CTX, notCharging);
    expect(originalMw.setAmpsCalls).toHaveLength(1);
    emitter.events.length = 0;

    await manager.rebuildMiddlewareFor(ROW.id);
    const rebuiltMw = middlewares.get(ROW.id);
    assertExists(rebuiltMw);

    expect(originalMw.shutdownCalls).toBe(1);
    expect(rebuiltMw).not.toBe(originalMw);
    expect(emitter.events.some((e) => e.type === "chargers_changed"))
      .toBe(true);
    // Car still reports the old amps (hasn't caught up) and is charging —
    // without the clear, "already commanded" would suppress this resend.
    const stillCharging = { ...STATE, isCharging: true, chargeAmps: 10 };
    await manager.startChargingAt(ROW.id, 16, CTX, stillCharging);
    expect(rebuiltMw.setAmpsCalls).toHaveLength(1);
  });

  it("never throws when the rebuilt config is still bad — reports unconfigured", async () => {
    registry.register(throwingMock<ChargerPlugin>("ChargerPlugin", {
      id: "broken",
      displayName: "Broken Charger",
      createChargerMiddleware: () => Promise.reject(new Error("still bad")),
    }));
    const row = { ...ROW, id: "charger-broken", chargerAdapterType: "broken" };
    await manager.addCharger(row);

    await manager.rebuildMiddlewareFor(row.id);

    const state = manager.getState(row.id);
    expect(state?.status).toBe("unconfigured");
    expect(state?.statusDetail).toBe("still bad");
  });

  it("re-resolves config on rebuild rather than reusing a stale bundle", async () => {
    chargerConfigs.set(ROW.id, { host: "10.0.0.1" });
    const seen: ChargerRowConfig[] = [];
    registry = new ChargerPluginRegistry();
    registerChargerPlugin(
      registry,
      middlewares,
      CHARGER_TYPE,
      "Simulated Charger",
      INFO,
      (_row, resolved) => {
        seen.push(resolved);
      },
    );
    manager = new ChargingPointManager(
      db,
      registry,
      throwingMock<VehicleManager>("VehicleManager", {}),
      throwingMock<EnergyPoller>("EnergyPoller", {
        tryGetRealtimeSnapshot: () => null,
      }),
      throwingMock<ConfigService>("ConfigService", {
        getSolar: () => Promise.resolve({ ...SOLAR_DEFAULTS }),
      }),
      emitter as unknown as TypedEventEmitter,
      testLogger,
    );
    await manager.addCharger(ROW);
    expect(seen).toHaveLength(1);
    expect(seen[0].config.host).toBe("10.0.0.1");
    chargerConfigs.set(ROW.id, { host: "10.0.0.99" });

    await manager.rebuildMiddlewareFor(ROW.id);

    expect(seen).toHaveLength(2);
    expect(seen[1].config.host).toBe("10.0.0.99");
  });

  it("edits one row's config without touching the other, and rebuilds only that row's middleware", async () => {
    const rowA = { ...ROW, id: "charger-a" };
    const rowB = { ...ROW, id: "charger-b" };
    chargerRows = [rowA, rowB];
    chargerConfigs.set(rowA.id, { host: "10.0.0.1" });
    chargerConfigs.set(rowB.id, { host: "10.0.0.2" });
    await manager.addCharger(rowA);
    await manager.addCharger(rowB);
    const originalMwA = middlewares.get(rowA.id);
    const originalMwB = middlewares.get(rowB.id);
    assertExists(originalMwA);
    assertExists(originalMwB);

    // Simulate a config edit on row A only.
    chargerConfigs.set(rowA.id, { host: "10.0.0.99" });
    await manager.rebuildMiddlewareFor(rowA.id);

    // Row B's stored config is untouched.
    expect(chargerConfigs.get(rowB.id)?.host).toBe("10.0.0.2");
    // Row A got a new middleware instance; row B's was never shut down or
    // reconstructed.
    const rebuiltMwA = middlewares.get(rowA.id);
    assertExists(rebuiltMwA);
    expect(rebuiltMwA).not.toBe(originalMwA);
    expect(originalMwA.shutdownCalls).toBe(1);
    expect(middlewares.get(rowB.id)).toBe(originalMwB);
    expect(originalMwB.shutdownCalls).toBe(0);
  });
});
