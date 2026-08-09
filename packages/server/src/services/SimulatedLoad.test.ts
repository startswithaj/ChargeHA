// The four combinations from docs/simulated-load.md, end to end: a real
// ChargingPointManager classifying the load and a real EnergyAdapterManager
// deciding what to add. Split across the two units, each half can pass while
// the pair is wrong — a vehicle miscl assified as metered still satisfies the
// manager's own tests, because they take the classification as an input.
import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type {
  DeviceInfo,
  EnergyData,
  VehicleChargeState,
} from "@chargeha/shared";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type { EnergyPlugin } from "@chargeha/shared/plugins";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleRow } from "../db/types.ts";
import { ChargerPluginRegistry } from "@chargeha/server/bootstrap/ChargerPluginRegistry";
import { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { ChargingPointManager } from "./ChargingPointManager.ts";
import { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { Logger } from "../lib/Logger.ts";
import { MockEventEmitter } from "../test-helpers/MockEventEmitter.ts";
import { MockEnergyAdapter } from "../test-helpers/MockEnergyAdapter.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";

describe("simulated load — the four inverter/vehicle combinations", () => {
  const testLogger = new Logger("SimulatedLoad", "error");

  /** Exporting 2kW with nothing charging. A 3kW car swings that to 1kW of
   *  import — but only if the car reaches the figures at all. */
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
  /** A plugin id the classifier must never special-case — the flag decides. */
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

  /** Wire the real pair: CPM classifies, EAM decides. Nothing here is a
   *  stand-in for the code under test — only its surroundings. */
  function build(
    { vehicleType, measuresLoad }: {
      vehicleType: string;
      measuresLoad: boolean;
    },
  ): EnergyAdapterManager {
    const states = new Map<string, VehicleChargeState>([[
      "car-1",
      buildVehicleChargeState({ isCharging: true, chargePowerKw: CAR_KW }),
    ]]);
    const vehicleManager = throwingMock<VehicleManager>("VehicleManager", {
      getAllStates: () => Promise.resolve(states),
      loadIsUnmetered: (adapterType: string) =>
        adapterType === SIMULATED_VEHICLE,
    });
    const db = throwingMock<AppDatabase>("AppDatabase", {
      getVehicles: () => Promise.resolve([vehicleRow(vehicleType)]),
      // No charger rows: these four cases are about the car alone. A charger's
      // own draw is covered by ChargingPointManager.vehicleControlPath.test.ts.
      getChargers: () => Promise.resolve([]),
      getConfig: () => Promise.resolve("inverter"),
    });
    const chargingPoints = new ChargingPointManager(
      db,
      new ChargerPluginRegistry(),
      vehicleManager,
      throwingMock<EnergyPoller>("EnergyPoller", {
        tryGetRealtimeSnapshot: () => null,
      }),
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

    return new EnergyAdapterManager(
      db,
      energyPlugins,
      testLogger,
      () => chargingPoints.getChargingLoadW(),
    );
  }

  const readingFor = async (opts: {
    vehicleType: string;
    measuresLoad: boolean;
  }) => {
    const manager = build(opts);
    await manager.ready();
    return await manager.getRealtimeData();
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
});
