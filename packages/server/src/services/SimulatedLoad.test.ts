// The four combinations from docs/simulated-load.md, end to end: a real
// ChargingPointManager classifying the load and a real EnergyAdapterManager
// deciding what to add. Split across the two units, each half can pass while
// the pair is wrong — a vehicle miscl assified as metered still satisfies the
// manager's own tests, because they take the classification as an input.
import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type {
  ChargerState,
  DeviceInfo,
  EnergyData,
  VehicleChargeState,
} from "@chargeha/shared";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  EnergyPlugin,
} from "@chargeha/shared/plugins";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow, VehicleRow } from "../db/types.ts";
import { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { ChargingPointManager } from "./ChargingPointManager.ts";
import { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { Logger } from "../lib/Logger.ts";
import { MockEventEmitter } from "../test-helpers/MockEventEmitter.ts";
import { MockEnergyAdapter } from "../test-helpers/MockEnergyAdapter.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("simulated load — the four inverter/vehicle combinations", () => {
  const testLogger = new Logger("SimulatedLoad", "error");

  // Exporting 2kW with nothing charging. A 3kW car swings that to 1kW of
  // import — but only if the car reaches the figures at all.
  const BASE_REALTIME: EnergyData = {
    solarProductionW: 5000,
    gridPowerW: -2000,
    homeConsumptionW: 3000,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const DEVICE_INFO: DeviceInfo = {
    id: "test",
    name: "Test Adapter",
    manufacturer: "Test",
    model: "T1",
  };

  const CAR_KW = 3;
  // A plugin id the classifier must never special-case — the flag decides.
  const SIMULATED_VEHICLE = "pretend-cars";
  const REAL_VEHICLE = "actual-cars";

  const vehicleRow = (adapterType: string): VehicleRow => ({
    id: "car-1",
    name: "Car",
    adapterType,
    priority: 1,
    config: "{}",
    mode: "auto",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });

  let emitter: MockEventEmitter;

  beforeEach(() => {
    emitter = new MockEventEmitter();
  });

  // Wire the real pair: CPM classifies, EAM decides. Nothing here is a
  // stand-in for the code under test — only its surroundings.
  function build(
    { vehicleType, measuresLoad, pointKind = "vehicle_api" }: {
      vehicleType: string;
      measuresLoad: boolean;
      pointKind?: ChargerRow["kind"];
    },
  ): {
    manager: EnergyAdapterManager;
    chargingPoints: ChargingPointManager;
    registerPoint: () => Promise<void>;
  } {
    const states = new Map<string, VehicleChargeState>([[
      "car-1",
      buildVehicleChargeState({ isCharging: true, chargePowerKw: CAR_KW }),
    ]]);
    const vehicleManager = throwingMock<VehicleManager>("VehicleManager", {
      getAllStates: () => Promise.resolve(states),
      loadIsUnmetered: (adapterType: string) =>
        adapterType === SIMULATED_VEHICLE,
    });
    // The car's own charging point, exactly as ensureVehicleChargingPoint
    // creates it: every vehicle whose plugin also has a charger role has one
    // in the running app, so the four cases must hold with it registered.
    const pointRow: ChargerRow = {
      id: "point-car-1",
      name: "Car",
      chargerAdapterType: vehicleType,
      chargerConfig: "{}",
      mode: "auto",
      priority: 1,
      vehicleId: "car-1",
      kind: pointKind,
      active: true,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const db = throwingMock<AppDatabase>("AppDatabase", {
      getVehicles: () => Promise.resolve([vehicleRow(vehicleType)]),
      getChargers: () => Promise.resolve([pointRow]),
      getChargerConfig: () => Promise.resolve({}),
      getChargerSecrets: () => Promise.resolve({}),
      getConfig: () => Promise.resolve("inverter"),
    });
    // A vehicle_api point reports the same draw the car does — it is the car's
    // own API, reached through the charger interface.
    const pointState: ChargerState = {
      chargerId: pointRow.id,
      isCharging: true,
      isPluggedIn: true,
      chargeAmps: 13,
      chargeAmpsMax: 32,
      chargeAmpsMin: 6,
      chargePowerKw: CAR_KW,
      chargerVoltage: 230,
      chargerPhases: 1,
      energyAddedKwh: 0,
      status: "charging",
      statusDetail: null,
      lastUpdated: "2024-01-01T00:00:00.000Z",
    };
    const pointMiddleware: ChargerMiddleware = {
      requestState: () => Promise.resolve(pointState),
      getCachedState: () => pointState,
      getChargerInfo: () => Promise.reject(new Error("not used")),
      startCharging: () => Promise.resolve(true),
      stopCharging: () => Promise.resolve(true),
      setChargeAmps: () => Promise.resolve(true),
      shutdown: () => Promise.resolve(),
    };
    const chargerPlugins = new ChargerPluginRegistry();
    chargerPlugins.register(throwingMock<ChargerPlugin>("ChargerPlugin", {
      id: vehicleType,
      displayName: vehicleType,
      // The same plugin object fills both roles for simulated vehicles, so
      // the flag it declares as a charger matches the vehicle one.
      loadIsUnmetered: vehicleType === SIMULATED_VEHICLE,
      // A plain object, not throwingMock: awaiting the returned middleware
      // probes `.then` on it, which a throwing proxy answers by throwing.
      createChargerMiddleware: () => Promise.resolve(pointMiddleware),
    }));
    const chargingPoints = new ChargingPointManager(
      db,
      chargerPlugins,
      vehicleManager,
      throwingMock<ConfigService>("ConfigService", {}),
      emitter as unknown as TypedEventEmitter,
      testLogger,
    );

    const plugin: EnergyPlugin = {
      id: "inverter",
      displayName: "Inverter",
      vendor: "Test",
      settingsComponentKey: null,
      configDef: {},
      secretKeys: [],
      measuresLoad,
      createAdapter: () =>
        Promise.resolve(new MockEnergyAdapter(BASE_REALTIME, DEVICE_INFO)),
      shutdown: () => Promise.resolve(),
      getRouter: () => null,
      getHealthChecks: () => [],
    };
    const energyPlugins = new EnergyPluginRegistry();
    energyPlugins.register(plugin);

    return {
      manager: new EnergyAdapterManager(
        db,
        energyPlugins,
        testLogger,
      ),
      chargingPoints,
      registerPoint: () => chargingPoints.addCharger(pointRow),
    };
  }

  // Run with the car's charging point registered, as the app always does.
  // The same four expectations must hold either way: one physical session is one load, whichever interface reports it.
  const readingFor = async (opts: {
    vehicleType: string;
    measuresLoad: boolean;
    withChargingPoint?: boolean;
    pointKind?: ChargerRow["kind"];
  }) => {
    const { manager, chargingPoints, registerPoint } = build(opts);
    if (opts.withChargingPoint) await registerPoint();
    await manager.ready();
    // Same orchestration as EnergyPoller.poll: fetch the load, pass it in.
    return await manager.getRealtimeData(
      await chargingPoints.getChargingLoadW(),
    );
  };

  it("1. simulated inverter + simulated car — nothing measured anything, so the draw is added", async () => {
    const data = await readingFor({
      vehicleType: SIMULATED_VEHICLE,
      measuresLoad: false,
    });

    expect(data.homeConsumptionW).toBe(6000);
    expect(data.gridPowerW).toBe(1000); // export becomes import
  });

  it("2. simulated inverter + real car — the draw is real but this inverter measured nothing, so it is added", async () => {
    const data = await readingFor({
      vehicleType: REAL_VEHICLE,
      measuresLoad: false,
    });

    expect(data.homeConsumptionW).toBe(6000);
    expect(data.gridPowerW).toBe(1000);
  });

  it("3. real inverter + simulated car — no electricity moved for it to measure, so the draw is added", async () => {
    const data = await readingFor({
      vehicleType: SIMULATED_VEHICLE,
      measuresLoad: true,
    });

    expect(data.homeConsumptionW).toBe(6000);
    expect(data.gridPowerW).toBe(1000);
  });

  it("4. real inverter + real car — already in the meter's reading, so nothing is added", async () => {
    const data = await readingFor({
      vehicleType: REAL_VEHICLE,
      measuresLoad: true,
    });

    expect(data).toEqual(BASE_REALTIME);
  });

  // The same four, with the vehicle_api charging point registered — the shape
  // the app actually runs in. Case 3 failed here while the point's draw was
  // classified as metered: the car vanished from a real inverter's reading,
  // so the controller ramped against surplus that did not exist.
  describe("with the car's own charging point registered", () => {
    const withPoint = { withChargingPoint: true };

    it("1. simulated inverter + simulated car — the draw is added", async () => {
      const data = await readingFor({
        ...withPoint,
        vehicleType: SIMULATED_VEHICLE,
        measuresLoad: false,
      });

      expect(data.homeConsumptionW).toBe(6000);
      expect(data.gridPowerW).toBe(1000);
    });

    it("2. simulated inverter + real car — the draw is added", async () => {
      const data = await readingFor({
        ...withPoint,
        vehicleType: REAL_VEHICLE,
        measuresLoad: false,
      });

      expect(data.homeConsumptionW).toBe(6000);
      expect(data.gridPowerW).toBe(1000);
    });

    it("3. real inverter + simulated car — the draw is added, not swallowed by the charging point", async () => {
      const data = await readingFor({
        ...withPoint,
        vehicleType: SIMULATED_VEHICLE,
        measuresLoad: true,
      });

      expect(data.homeConsumptionW).toBe(6000);
      expect(data.gridPowerW).toBe(1000);
    });

    it("4. real inverter + real car — nothing is added, and the draw is not counted twice", async () => {
      const data = await readingFor({
        ...withPoint,
        vehicleType: REAL_VEHICLE,
        measuresLoad: true,
      });

      expect(data).toEqual(BASE_REALTIME);
    });
  });

  // Same rule one level out: what decides is whether the equipment reporting
  // the draw could have moved any electricity, not whether it is a car or a
  // charger. An in-memory EVSE cannot, so a real inverter never saw it.
  describe("with a smart charger reporting the draw", () => {
    const smart = { withChargingPoint: true, pointKind: "smart" as const };

    it("real inverter + simulated charger — the draw is added", async () => {
      const data = await readingFor({
        ...smart,
        vehicleType: SIMULATED_VEHICLE,
        measuresLoad: true,
      });

      expect(data.homeConsumptionW).toBe(6000);
      expect(data.gridPowerW).toBe(1000);
    });

    it("real inverter + real charger — already measured, so nothing is added", async () => {
      const data = await readingFor({
        ...smart,
        vehicleType: REAL_VEHICLE,
        measuresLoad: true,
      });

      expect(data).toEqual(BASE_REALTIME);
    });
  });
});
