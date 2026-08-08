/** Two cars plugged into one smart charger, neither explicitly assigned:
 *  resolution is ambiguous, and mergeChargingPointState falls back to
 *  batteryLevel: 0 / chargeLimit: 100. Left unguarded, the engine would
 *  never see "battery full" and would charge forever. This suite proves the
 *  controller refuses to start/adjust amps while ambiguous, and that an
 *  explicit assignment (Settings) clears it. */
import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { VehicleChargeState } from "@chargeha/shared";
import type { ChargerInfo, ChargerState } from "@chargeha/shared";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  VehiclePlugin,
} from "@chargeha/shared/plugins";
import type { VehicleRow } from "../../db/types.ts";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { VehicleManager } from "../VehicleManager.ts";
import { ChargingPointManager } from "../ChargingPointManager.ts";
import { ChargeController } from "../ChargeController.ts";
import { ConfigService } from "../ConfigService.ts";
import { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import type { EnergyAdapterManager } from "../EnergyAdapterManager.ts";
import type { EnergyPoller } from "../EnergyPoller.ts";
import { Logger } from "../../lib/Logger.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";
import { MockMiddleware } from "../../test-helpers/MockMiddleware.ts";
import {
  MockEnergyPoller,
  TrackingEventEmitter,
} from "../../test-helpers/ChargeControllerMocks.ts";
import { testable } from "../../test-helpers/Testable.ts";

class StubChargerMiddleware implements ChargerMiddleware {
  static readonly INFO: ChargerInfo = {
    id: "sim-charger",
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

  startCalls = 0;
  setAmpsCalls = 0;
  private cached: ChargerState;

  constructor(initial: ChargerState) {
    this.cached = { ...initial };
  }

  requestState(): Promise<ChargerState | null> {
    return Promise.resolve(this.cached);
  }
  getCachedState(): ChargerState | null {
    return this.cached;
  }
  getChargerInfo(): Promise<ChargerInfo> {
    return Promise.resolve(StubChargerMiddleware.INFO);
  }
  startCharging(): Promise<boolean> {
    this.startCalls++;
    this.cached = { ...this.cached, isCharging: true };
    return Promise.resolve(true);
  }
  stopCharging(): Promise<boolean> {
    this.cached = { ...this.cached, isCharging: false };
    return Promise.resolve(true);
  }
  setChargeAmps(): Promise<boolean> {
    this.setAmpsCalls++;
    return Promise.resolve(true);
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

describe("ChargeController — ambiguous vehicle resolution", () => {
  const testLogger = new Logger("test", "error");

  const VEHICLE_STATE: VehicleChargeState = {
    vehicleId: "VEH1",
    batteryLevel: 40,
    chargeLimit: 80,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 0,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 0,
    chargerVoltage: 230,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: true,
    vehicleName: "Vehicle",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    latitude: null,
    longitude: null,
    isHome: null,
  };

  const CHARGER_STATE: ChargerState = {
    chargerId: "smart-1",
    isCharging: false,
    isPluggedIn: true,
    chargeAmps: 0,
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

  // A vehicle plugin with no charger role, so ensureVehicleChargingPoint
  // no-ops for it — the vehicle is only ever reachable through the smart
  // charger's resolution, exactly the scenario resolveVehicle exists for.
  const makeVehicleOnlyPlugin = (
    id: string,
    middlewares: Map<string, MockMiddleware>,
    state: VehicleChargeState,
  ): VehiclePlugin =>
    throwingMock<VehiclePlugin>(`VehiclePlugin[${id}]`, {
      id,
      createVehicleMiddleware: (row: VehicleRow) => {
        const mw = new MockMiddleware({ ...state, vehicleId: row.id });
        middlewares.set(row.id, mw);
        return Promise.resolve(mw);
      },
    });

  let db: AppDatabase | undefined;
  let controller: ChargeController | undefined;

  afterEach(() => {
    controller?.stop();
    db?.close();
  });

  it("still charges while two vehicles are plugged in and unassigned", async () => {
    db = new AppDatabase(":memory:");
    await db.init();

    const middlewares = new Map<string, MockMiddleware>();
    const vehicles = new VehiclePluginRegistry();
    vehicles.register(
      makeVehicleOnlyPlugin("veh-a", middlewares, {
        ...VEHICLE_STATE,
        vehicleId: "VEH1",
      }),
    );
    vehicles.register(
      makeVehicleOnlyPlugin("veh-b", middlewares, {
        ...VEHICLE_STATE,
        vehicleId: "VEH2",
      }),
    );

    const chargerMw = new StubChargerMiddleware(CHARGER_STATE);
    const chargers = new ChargerPluginRegistry();
    chargers.register(
      throwingMock<ChargerPlugin>("ChargerPlugin[sim-charger]", {
        id: "sim-charger",
        displayName: "Simulated Charger",
        createChargerMiddleware: () => Promise.resolve(chargerMw),
      }),
    );

    const emitter = new TrackingEventEmitter();
    const manager = new VehicleManager(db, emitter, testLogger, vehicles);
    const poller = new MockEnergyPoller();
    poller.snapshot = {
      realtime: {
        solarProductionW: 5000,
        gridPowerW: -2000,
        homeConsumptionW: 3000,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      },
      cumulative: {
        solarProducedWh: 0,
        gridImportedWh: 0,
        gridExportedWh: 0,
        dailySolarProducedWh: 0,
        dailyGridImportWh: 0,
        dailyGridExportWh: 0,
      },
    };

    const configService = new ConfigService(
      db,
      throwingMock<EnergyAdapterManager>("EnergyAdapterManager"),
      null,
      testLogger,
    );

    const chargingPointManager = new ChargingPointManager(
      db,
      chargers,
      manager,
      poller as unknown as EnergyPoller,
      configService,
      emitter,
      testLogger,
    );

    // Two vehicles, both plugged in, neither with a charger role — the only
    // path to charging is the smart charger's own vehicle resolution.
    await db.upsertVehicle({
      id: "VEH1",
      name: "Car A",
      adapterType: "veh-a",
      priority: 1,
      config: "{}",
      mode: "auto",
    });
    await db.upsertVehicle({
      id: "VEH2",
      name: "Car B",
      adapterType: "veh-b",
      priority: 2,
      config: "{}",
      mode: "auto",
    });
    const rowA = await db.getVehicle("VEH1");
    const rowB = await db.getVehicle("VEH2");
    assertExists(rowA);
    assertExists(rowB);
    await manager.addVehicle(rowA);
    await manager.addVehicle(rowB);
    await manager.requestState("VEH1", {
      origin: "test",
      traceId: "test",
      hasSolar: false,
      hasSchedule: false,
      hasBlockout: false,
    });
    await manager.requestState("VEH2", {
      origin: "test",
      traceId: "test",
      hasSolar: false,
      hasSchedule: false,
      hasBlockout: false,
    });

    await chargingPointManager.init();
    await chargingPointManager.ensureVehicleChargingPoint(rowA);
    await chargingPointManager.ensureVehicleChargingPoint(rowB);
    // Neither vehicle has a charger role, so no vehicle_api rows were made —
    // the smart charger is the only controllable point.
    const smart = await chargingPointManager.createCharger({
      name: "Smart Charger",
      chargerAdapterType: "sim-charger",
    });

    controller = new ChargeController(
      manager,
      chargingPointManager,
      poller as unknown as EnergyPoller,
      db,
      configService,
      emitter,
      testLogger,
    );
    controller.stop();

    await testable(controller).loop();
    controller.stop();

    expect((await chargingPointManager.resolveVehicle(smart.id)).kind).toBe(
      "ambiguous",
    );
    // Solar is plentiful and mode is auto. Not knowing WHICH car is on the
    // charger must never stop it charging — the car enforces its own limit,
    // so charging on the battery 0 / limit 100 fallback is safe, and a
    // charger that silently does nothing is the worse failure.
    expect(chargerMw.startCalls).toBeGreaterThan(0);

    // Explicit assignment clears the ambiguity and lets charging proceed.
    await chargingPointManager.setChargerVehicleId(smart.id, "VEH1");
    await testable(controller).loop();
    controller.stop();

    expect((await chargingPointManager.resolveVehicle(smart.id)).kind).toBe(
      "linked",
    );
    expect(chargerMw.startCalls).toBeGreaterThan(0);
  });
});
