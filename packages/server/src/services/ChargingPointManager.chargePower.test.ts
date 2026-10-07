import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { CallContext, ChargerState } from "@chargeha/shared";
import { buildChargerState } from "@chargeha/shared/test-factories";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow } from "../db/types.ts";
import { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import type { ChargerPlugin } from "@chargeha/shared/plugins";
import type { VehicleManager } from "./VehicleManager.ts";
import type { ConfigService } from "./ConfigService.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { ChargingPointManager } from "./ChargingPointManager.ts";
import { Logger } from "../lib/Logger.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";
import { StubChargerMiddleware } from "../test-helpers/StubChargerMiddleware.ts";

describe("ChargingPointManager charge power", () => {
  const ROW: ChargerRow = {
    id: "cp-VIN1",
    name: "Titan",
    chargerAdapterType: "tesla",
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: null,
    kind: "vehicle_api",
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  const CHARGING = buildChargerState({
    chargerId: ROW.id,
    isCharging: true,
    chargeAmps: 9,
    chargePowerKw: null,
    chargerVoltage: 246,
    chargerPhases: 2,
    status: "charging",
  });

  const SOLAR_DEFAULTS = {
    solarTrackingEnabled: true,
    solarTrackingMode: "solar_only" as const,
    solarReference: "excess" as const,
    solarMarginKw: 0,
    minSolarGenerationKw: 0.2,
    minExcessSolarKw: null,
    gridVoltage: 230,
    consumptionExcludesCharging: false,
    gracePeriodMinutes: 6,
    cooldownPeriodMinutes: 15,
    ampDebounceThreshold: 2,
    ampDebounceSettleMinutes: 3,
  };

  const CTX: CallContext = { origin: "test", traceId: "test" };

  let threePhaseCharger: boolean;
  let middlewares: Map<string, StubChargerMiddleware>;
  let manager: ChargingPointManager;

  const boot = async (state: ChargerState): Promise<StubChargerMiddleware> => {
    await manager.init();
    const mw = middlewares.get(ROW.id);
    assertExists(mw);
    mw.nextState = state;
    await manager.requestState(ROW.id, CTX);
    return mw;
  };

  beforeEach(() => {
    threePhaseCharger = true;
    middlewares = new Map();
    const db = throwingMock<AppDatabase>("AppDatabase", {
      getChargers: () => Promise.resolve([ROW]),
      getVehicles: () => Promise.resolve([]),
      getChargerConfig: () => Promise.resolve({}),
      getChargerSecrets: () => Promise.resolve({}),
    });
    const registry = new ChargerPluginRegistry();
    registry.register(throwingMock<ChargerPlugin>("ChargerPlugin", {
      id: "tesla",
      displayName: "Tesla",
      createChargerMiddleware: (row: ChargerRow) => {
        const mw = new StubChargerMiddleware(null);
        middlewares.set(row.id, mw);
        return Promise.resolve(mw);
      },
    }));
    const vehicleManager = throwingMock<VehicleManager>("VehicleManager", {
      getAllStates: () => Promise.resolve(new Map()),
    });
    const configService = throwingMock<ConfigService>("ConfigService", {
      getSolar: () => Promise.resolve({ ...SOLAR_DEFAULTS, threePhaseCharger }),
    });
    manager = new ChargingPointManager(
      db,
      registry,
      vehicleManager,
      configService,
      new TypedEventEmitter(),
      new Logger("ChargingPointManager", "error"),
    );
  });

  it("derives power from amps × volts × phases when the charger reports none", async () => {
    await boot({ ...CHARGING, chargerPhases: 3 });

    expect(manager.getState(ROW.id)?.chargePowerKw).toBe(6.64);
  });

  it("treats a reported 2 as 3 phases when the three-phase switch is on", async () => {
    await boot(CHARGING);

    expect(manager.getState(ROW.id)?.chargePowerKw).toBe(6.64);
  });

  it("keeps a reported 2 when the three-phase switch is off", async () => {
    threePhaseCharger = false;
    await boot(CHARGING);

    expect(manager.getState(ROW.id)?.chargePowerKw).toBe(4.43);
  });

  it("reports zero power when not charging", async () => {
    await boot({ ...CHARGING, isCharging: false });

    expect(manager.getState(ROW.id)?.chargePowerKw).toBe(0);
  });

  it("follows a new amp setting without a new reading", async () => {
    const mw = await boot(CHARGING);
    mw.seedCache({ ...CHARGING, chargeAmps: 13 });

    expect(manager.getState(ROW.id)?.chargePowerKw).toBe(9.59);
  });

  it("counts derived power in the charging load", async () => {
    await boot(CHARGING);

    const load = await manager.getChargingLoadW();

    expect(load.meteredW).toBe(6640);
  });

  it("does not derive amps while cachedSolar is null pre-init", async () => {
    await manager.addCharger(ROW);
    const mw = middlewares.get(ROW.id);
    assertExists(mw);
    mw.nextState = { ...CHARGING, chargeAmps: null, chargePowerKw: 2.3 };

    const state = await manager.requestState(ROW.id, CTX);

    expect(state?.chargeAmps).toBeNull();
  });

  it("derives amps from watts using the configured grid voltage", async () => {
    threePhaseCharger = false;
    await boot({
      ...CHARGING,
      chargeAmps: null,
      chargePowerKw: 2.3,
      chargerVoltage: null,
      chargerPhases: 1,
    });

    expect(manager.getState(ROW.id)?.chargeAmps).toBe(10);
  });

  it("falls back to threePhaseCharger when the charger reports no phases", async () => {
    await boot({
      ...CHARGING,
      chargeAmps: null,
      chargePowerKw: 6.9,
      chargerVoltage: null,
      chargerPhases: null,
    });

    expect(manager.getState(ROW.id)?.chargeAmps).toBe(10);
  });
});
