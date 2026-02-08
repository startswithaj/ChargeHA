/**
 * Shared test harness for ChargeController test suites.
 *
 * Each test calls `setupController(opts)` and gets back a `ControllerCtx`
 * with fresh in-memory state plus bound helpers. Tests typically:
 *
 *   const ctx = await setupController({ isCharging: true });
 *   await ctx.runOneLoop();
 *   expect(ctx.adapter.commands).toContainEqual({ cmd: "stop" });
 *
 * Always pair with `afterEach(() => { ctx?.controller.stop(); ctx?.db.close(); })`.
 */

import { assertExists } from "@std/assert";
import type {
  CumulativeEnergyData,
  EnergyData,
  VehicleAdapter,
  VehicleChargeState,
  VehicleMode,
} from "@chargeha/shared";
import type { ConfigKey, CoreConfigKey } from "@chargeha/shared/schemas";
import type { DayOfWeek } from "@chargeha/shared";
import type { DecisionCheck } from "@chargeha/shared/engine";
import type { VehicleRow } from "../db/types.ts";
import { AppDatabase } from "../db/AppDatabase.ts";
import { VehicleManager } from "../services/VehicleManager.ts";
import type { EnergyPoller } from "../services/EnergyPoller.ts";
import { ChargeController } from "../services/ChargeController.ts";
import { ConfigService } from "../services/ConfigService.ts";
import type { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import { Logger } from "../lib/Logger.ts";
import { testable } from "./Testable.ts";
import {
  MockAdapter,
  MockEnergyPoller,
  TrackingEventEmitter,
} from "./ChargeControllerMocks.ts";
import { TeslaVehicleMiddleware } from "@chargeha/plugins/vehicles/tesla/server/TeslaVehicleMiddleware";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { VehiclePlugin } from "@chargeha/plugins/types";
import { throwingMock } from "./throwingMock.ts";

export const VIN = "TEST_VIN_001";

export const BASE_STATE: VehicleChargeState = {
  vehicleId: VIN,
  batteryLevel: 60,
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
  vehicleName: "Test Car",
  lastUpdated: "2024-01-01T00:00:00.000Z",
  latitude: null,
  longitude: null,
  isHome: null,
};

export const BASE_ENERGY: EnergyData = {
  solarProductionW: 5000,
  gridPowerW: -2000,
  homeConsumptionW: 3000,
  batteryPowerW: null,
  batterySoc: null,
  gridVoltageV: null,
  lastUpdated: "2024-01-01T00:00:00.000Z",
};

const ZERO_CUMULATIVE: CumulativeEnergyData = {
  solarProducedWh: 0,
  gridImportedWh: 0,
  gridExportedWh: 0,
  dailySolarProducedWh: 0,
  dailyGridImportWh: 0,
  dailyGridExportWh: 0,
};

/** Tests that call requestState directly are signalling "refetch now" — they
 *  usually just mutated adapter.state and want the middleware to see it. Use
 *  forceRefresh so the middleware bypasses its cache (which is otherwise
 *  fresh for 20 min under the no-solar/no-schedule/no-blockout defaults). */
export const REQUEST_CONTEXT = {
  origin: "test",
  traceId: "test",
  hasSolar: false,
  hasSchedule: false,
  hasBlockout: false,
  forceRefresh: true,
} as const;

const DAY_MAP: Record<number, DayOfWeek> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

/** A schedule window covering the next two hours from "now", on today's
 *  day-of-week. Use for tests that need a schedule that's active right now. */
export function currentScheduleWindow(): {
  today: DayOfWeek;
  startTime: string;
  endTime: string;
} {
  const now = new Date();
  const startH = now.getHours();
  const endH = (startH + 2) % 24;
  return {
    today: DAY_MAP[now.getDay()],
    startTime: `${String(startH).padStart(2, "0")}:00`,
    endTime: `${String(endH).padStart(2, "0")}:00`,
  };
}

const SETUP_REQUEST_CONTEXT = {
  origin: "test:setup",
  traceId: "test",
  hasSolar: false,
  hasSchedule: false,
  hasBlockout: false,
};

const testVehicleManagerLogger = new Logger("VehicleManager", "error");
const testControllerLogger = new Logger("ChargeController", "error");

type ControllerLogRow = Awaited<
  ReturnType<AppDatabase["logs"]["getControllerLogs"]>
>["rows"][0];
type ParsedControllerLog =
  & ControllerLogRow
  & { inputs: unknown; checks: DecisionCheck[] };

function parseLog(row: ControllerLogRow): ParsedControllerLog {
  return {
    ...row,
    inputs: JSON.parse(row.inputsJson),
    checks: JSON.parse(row.checksJson) as DecisionCheck[],
  };
}

export interface ControllerCtx {
  db: AppDatabase;
  adapter: MockAdapter;
  manager: VehicleManager;
  poller: MockEnergyPoller;
  controller: ChargeController;
  trackingEmitter: TrackingEventEmitter;
  /** Run one controller loop iteration. Cancels the next-timer afterwards
   *  so FakeTime.tick can't fire a concurrent loop later in the test. */
  runOneLoop(): Promise<void>;
  getLastLog(): Promise<ControllerLogRow | null>;
  getLastLogParsed(): Promise<ParsedControllerLog | null>;
}

/** Build a mock VehiclePluginRegistry that creates a TeslaVehicleMiddleware
 *  wrapping the adapter returned by the given resolver. */
export function makeMockRegistry(
  resolveAdapter: (row: VehicleRow) => MockAdapter,
): VehiclePluginRegistry {
  const plugin = throwingMock<VehiclePlugin>("VehiclePlugin[tesla]", {
    id: "tesla",
    createMiddleware: (row: VehicleRow) =>
      Promise.resolve(
        new TeslaVehicleMiddleware(
          resolveAdapter(row) as unknown as VehicleAdapter,
          testVehicleManagerLogger,
        ),
      ),
  });
  return throwingMock<VehiclePluginRegistry>("VehiclePluginRegistry", {
    get: () => plugin,
  });
}

interface ControllerStack {
  db: AppDatabase;
  manager: VehicleManager;
  poller: MockEnergyPoller;
  controller: ChargeController;
  trackingEmitter: TrackingEventEmitter;
}

/** Build the shared db/manager/poller/controller wiring used by both the
 *  single- and multi-vehicle setup helpers. The caller is responsible for
 *  inserting vehicles and seeding initial state before calling this. */
async function buildControllerStack(
  resolveAdapter: (row: VehicleRow) => MockAdapter,
  energy: EnergyData | null,
  configOverrides: Partial<Record<ConfigKey, string>>,
): Promise<ControllerStack> {
  const db = new AppDatabase(":memory:");
  await db.init();

  const trackingEmitter = new TrackingEventEmitter();
  const manager = new VehicleManager(
    db,
    trackingEmitter,
    testVehicleManagerLogger,
    makeMockRegistry(resolveAdapter),
  );

  const poller = new MockEnergyPoller();
  if (energy) {
    poller.snapshot = { realtime: energy, cumulative: { ...ZERO_CUMULATIVE } };
  }

  await Object.entries(configOverrides)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .reduce(async (prev, [key, value]) => {
      await prev;
      await db.setConfig(key as CoreConfigKey, value);
    }, Promise.resolve());

  const configService = new ConfigService(
    db,
    throwingMock<EnergyAdapterManager>("EnergyAdapterManager"),
    null,
    new Logger("ConfigService", "error"),
  );

  const controller = new ChargeController(
    manager,
    poller as unknown as EnergyPoller,
    db,
    configService,
    trackingEmitter,
    testControllerLogger,
  );
  // ChargeController auto-starts in its ctor (real setTimeout). Cancel the
  // initial timer so afterEach's stop() doesn't leak it into later tests
  // and FakeTime users don't fire it unexpectedly.
  controller.stop();

  return { db, manager, poller, controller, trackingEmitter };
}

export async function setupController(
  vehicleState: Partial<VehicleChargeState> = {},
  vehicleMode: VehicleMode = "auto",
  energy: EnergyData | null = BASE_ENERGY,
  configOverrides: Partial<Record<ConfigKey, string>> = {},
  options: { skipInitialState?: boolean } = {},
): Promise<ControllerCtx> {
  const adapter = new MockAdapter(VIN, { ...BASE_STATE, ...vehicleState });
  const stack = await buildControllerStack(
    () => adapter,
    energy,
    configOverrides,
  );
  const { db, manager, poller, controller, trackingEmitter } = stack;

  await db.upsertVehicle({
    id: VIN,
    name: "Test Car",
    adapterType: "tesla",
    priority: 1,
    config: "{}",
    mode: vehicleMode,
  });
  const row = await db.getVehicle(VIN);
  assertExists(row);
  await manager.addVehicle(row);
  if (!options.skipInitialState) {
    await manager.requestState(VIN, SETUP_REQUEST_CONTEXT);
  }

  return {
    db,
    adapter,
    manager,
    poller,
    controller,
    trackingEmitter,
    async runOneLoop() {
      // Drop the next-timer scheduled by loop() so FakeTime.tick can't fire
      // a concurrent loop call while later test assertions run.
      await testable(controller).loop();
      controller.stop();
    },
    async getLastLog() {
      const { rows } = await db.logs.getControllerLogs({ limit: 1, offset: 0 });
      return rows[0] ?? null;
    },
    async getLastLogParsed() {
      const { rows } = await db.logs.getControllerLogs({ limit: 1, offset: 0 });
      return rows[0] ? parseLog(rows[0]) : null;
    },
  };
}

export interface MultiVehicleSpec {
  vin: string;
  name: string;
  priority: number;
  state?: Partial<VehicleChargeState>;
  mode?: VehicleMode;
}

export interface MultiControllerCtx {
  db: AppDatabase;
  adapters: Map<string, MockAdapter>;
  manager: VehicleManager;
  poller: MockEnergyPoller;
  controller: ChargeController;
  trackingEmitter: TrackingEventEmitter;
  runOneLoop(): Promise<void>;
  getLogForVehicle(vehicleId: string): Promise<ParsedControllerLog | null>;
}

/** Multi-vehicle variant of setupController. Vehicles are inserted into the
 *  DB in array order — pass them in reverse-priority order to test that the
 *  controller honours `priority` rather than DB row order. */
export async function setupMultiVehicleController(
  vehicles: MultiVehicleSpec[],
  energy: EnergyData | null = BASE_ENERGY,
  configOverrides: Partial<Record<ConfigKey, string>> = {},
): Promise<MultiControllerCtx> {
  const adapters = new Map<string, MockAdapter>(
    vehicles.map((v) => [
      v.vin,
      new MockAdapter(v.vin, {
        ...BASE_STATE,
        vehicleId: v.vin,
        vehicleName: v.name,
        ...v.state,
      }),
    ]),
  );

  const stack = await buildControllerStack(
    (row) => {
      const a = adapters.get(row.id);
      assertExists(a);
      return a;
    },
    energy,
    configOverrides,
  );
  const { db, manager, poller, controller, trackingEmitter } = stack;

  await vehicles.reduce(async (prev, v) => {
    await prev;
    await db.upsertVehicle({
      id: v.vin,
      name: v.name,
      adapterType: "tesla",
      priority: v.priority,
      config: "{}",
      mode: v.mode ?? "auto",
    });
    const row = await db.getVehicle(v.vin);
    assertExists(row);
    await manager.addVehicle(row);
    await manager.requestState(v.vin, SETUP_REQUEST_CONTEXT);
  }, Promise.resolve());

  return {
    db,
    adapters,
    manager,
    poller,
    controller,
    trackingEmitter,
    async runOneLoop() {
      await testable(controller).loop();
      controller.stop();
    },
    async getLogForVehicle(vehicleId: string) {
      const { rows } = await db.logs.getControllerLogs({
        limit: 1,
        offset: 0,
        vehicleId,
      });
      return rows[0] ? parseLog(rows[0]) : null;
    },
  };
}
