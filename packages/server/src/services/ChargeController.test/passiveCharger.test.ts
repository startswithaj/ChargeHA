// A car driven by its own API owns its charging session. The smart charger it is plugged into must stop deciding — no mode, no schedules, no solar
// tracking, no amp adjustment — while still physically allowing current, because an OCPP charger left at a stale ChargingProfile caps the car at whatever solar tracking last asked for, and one that was never sent RemoteStart never closes its contactor at all.
import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { ChargerState, VehicleChargeState } from "@chargeha/shared";
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
  startCalls = 0;
  stopCalls = 0;
  ampCalls: number[] = [];
  stateCalls = 0;
  private cached: ChargerState;

  constructor(initial: ChargerState) {
    this.cached = { ...initial };
  }

  requestState(): Promise<ChargerState | null> {
    this.stateCalls++;
    return Promise.resolve(this.cached);
  }
  getCachedState(): ChargerState | null {
    return this.cached;
  }
  startCharging(): Promise<boolean> {
    this.startCalls++;
    this.cached = { ...this.cached, isCharging: true };
    return Promise.resolve(true);
  }
  stopCharging(): Promise<boolean> {
    this.stopCalls++;
    this.cached = { ...this.cached, isCharging: false };
    return Promise.resolve(true);
  }
  setChargeAmps(amps: number): Promise<boolean> {
    this.ampCalls.push(amps);
    return Promise.resolve(true);
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

describe("ChargeController — passive smart charger", () => {
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
    isHome: true,
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
    controlMode: "amps",
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const SNAPSHOT = {
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

  // A vehicle plugin that also has a charger role, so
  // ensureVehicleChargingPoint gives the car its own vehicle_api point — the thing the API-control toggle switches.
  const registerApiVehicle = (
    id: string,
    vehicles: VehiclePluginRegistry,
    chargers: ChargerPluginRegistry,
    middlewares: Map<string, MockMiddleware>,
    apiPoints: Map<string, StubChargerMiddleware>,
    state: VehicleChargeState,
  ): void => {
    vehicles.register(throwingMock<VehiclePlugin>(`VehiclePlugin[${id}]`, {
      id,
      createVehicleMiddleware: (row: VehicleRow) => {
        const mw = new MockMiddleware({ ...state, vehicleId: row.id });
        middlewares.set(row.id, mw);
        return Promise.resolve(mw);
      },
    }));
    chargers.register(throwingMock<ChargerPlugin>(`ChargerPlugin[${id}]`, {
      id,
      displayName: id,
      createChargerMiddleware: (row) => {
        const mw = new StubChargerMiddleware(CHARGER_STATE);
        apiPoints.set(row.id, mw);
        return Promise.resolve(mw);
      },
    }));
  };

  let db: AppDatabase | undefined;
  let controller: ChargeController | undefined;

  afterEach(() => {
    controller?.stop();
    db?.close();
  });

  // One smart charger, plus `cars` vehicles that each have an API control
  // path of their own. Returns everything a test needs to drive a loop.
  const setup = async (cars: string[]) => {
    db = new AppDatabase(":memory:");
    await db.init();

    const middlewares = new Map<string, MockMiddleware>();
    const apiPoints = new Map<string, StubChargerMiddleware>();
    const vehicles = new VehiclePluginRegistry();
    const chargers = new ChargerPluginRegistry();
    const chargerMw = new StubChargerMiddleware(CHARGER_STATE);
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
    poller.snapshot = SNAPSHOT;
    const configService = new ConfigService(
      db,
      throwingMock<EnergyAdapterManager>("EnergyAdapterManager"),
      null,
      testLogger,
    );
    const cpm = new ChargingPointManager(
      db,
      chargers,
      manager,
      configService,
      emitter,
      testLogger,
    );

    await cars.reduce(
      (chain, id, i) =>
        chain.then(async () => {
          assertExists(db);
          registerApiVehicle(
            `veh-${id}`,
            vehicles,
            chargers,
            middlewares,
            apiPoints,
            { ...VEHICLE_STATE, vehicleId: id },
          );
          await db.upsertVehicle({
            id,
            name: `Car ${id}`,
            adapterType: `veh-${id}`,
            priority: i + 1,
            config: "{}",
            mode: "auto",
          });
          const row = await db.getVehicle(id);
          assertExists(row);
          await manager.addVehicle(row);
          await manager.requestState(id, {
            origin: "test",
            traceId: "test",
            hasSolar: false,
            hasSchedule: false,
            hasBlockout: false,
          });
          await cpm.init();
          await cpm.ensureVehicleChargingPoint(row);
        }),
      Promise.resolve(),
    );

    const smart = await cpm.createCharger({
      name: "Smart Charger",
      chargerAdapterType: "sim-charger",
    });

    controller = new ChargeController(
      manager,
      cpm,
      poller as unknown as EnergyPoller,
      db,
      configService,
      emitter,
      testLogger,
    );
    controller.stop();

    return { cpm, chargerMw, smart, controller, middlewares, apiPoints };
  };

  const runLoop = async (c: ChargeController): Promise<void> => {
    await testable(c).loop();
    c.stop();
  };

  it("issues one standing permission and nothing else, loop after loop", async () => {
    const { cpm, chargerMw, smart, controller: c } = await setup(["VEH1"]);
    await cpm.setVehicleApiControl("VEH1", true);

    await runLoop(c);
    await runLoop(c);

    expect((await cpm.getControlPath(smart.id)).owner).toBe("vehicle_api");
    // The connector's own maximum, once — not a solar-tracked figure, and
    // not re-sent every loop.
    expect(chargerMw.ampCalls).toEqual([32]);
    expect(chargerMw.startCalls).toBe(1);
    expect(chargerMw.stopCalls).toBe(0);
  });

  it("keeps polling a passive charger so its meter reading stays live", async () => {
    const { cpm, chargerMw, controller: c } = await setup(["VEH1"]);
    await cpm.setVehicleApiControl("VEH1", true);
    const before = chargerMw.stateCalls;

    await runLoop(c);
    await runLoop(c);

    expect(chargerMw.stateCalls).toBeGreaterThan(before + 1);
  });

  it("still drives the car through its own charging point", async () => {
    const { cpm, smart, controller: c, apiPoints } = await setup(["VEH1"]);
    await cpm.setVehicleApiControl("VEH1", true);

    await runLoop(c);

    // The session is not invisible: it moved off the charger's target and
    // onto the car's own, which is what the allocator sees.
    expect((await cpm.getControlPath(smart.id)).passiveForVehicleId).toBe(
      "VEH1",
    );
    expect(cpm.getState("cp-VEH1")).not.toBeNull();
    expect(apiPoints.get("cp-VEH1")?.startCalls).toBeGreaterThan(0);
  });

  it("hands control back to the charger when API control is switched off", async () => {
    const { cpm, chargerMw, smart, controller: c } = await setup(["VEH1"]);
    await cpm.setVehicleApiControl("VEH1", true);
    await runLoop(c);
    expect(chargerMw.ampCalls).toEqual([32]);

    await cpm.setVehicleApiControl("VEH1", false);
    await runLoop(c);

    expect((await cpm.getControlPath(smart.id)).owner).toBe("self");
    // Back under solar tracking, so the amps it is now given are decided,
    // not the standing maximum left behind by the hold.
    expect(chargerMw.ampCalls.length).toBeGreaterThan(1);
  });

  it("leaves the charger in full control for a second, non-API car", async () => {
    const { cpm, smart, controller: c } = await setup(["VEH1", "VEH2"]);
    await cpm.setVehicleApiControl("VEH1", true);
    await cpm.setVehicleApiControl("VEH2", false);

    await runLoop(c);

    const path = await cpm.getControlPath(smart.id);
    expect(path.owner).toBe("self");
    expect((await cpm.resolveVehicle(smart.id)).vehicleId).toBe("VEH2");
  });
});
