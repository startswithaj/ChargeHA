import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { VehicleAdapter, VehicleChargeState } from "@chargeha/shared";
import type { VehicleRow } from "../../db/types.ts";
import { AppDatabase } from "../../db/AppDatabase.ts";
import type { TypedEventEmitter } from "../../services/TypedEventEmitter.ts";
import { VehicleManager } from "../../services/VehicleManager.ts";
import { VehicleService } from "../../services/VehicleService.ts";
import { Logger } from "../../lib/Logger.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { TeslaVehicleMiddleware } from "@chargeha/plugins/vehicles/tesla/server/TeslaVehicleMiddleware";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { throwingMock } from "../../test-helpers/throwingMock.ts";
import { MockVehicleAdapter } from "../../test-helpers/MockVehicleAdapter.ts";

describe("Vehicles tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  const testLogger = new Logger("VehiclesTrpc", "error");

  const VIN = "5YJ3E1EA1MF000001";
  const VIN2 = "5YJ3E1EA1MF000002";

  const MOCK_STATE: VehicleChargeState = {
    vehicleId: VIN,
    batteryLevel: 72,
    chargeLimit: 80,
    isCharging: true,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 7,
    chargerVoltage: 240,
    chargerPhases: 1,
    energyAddedKwh: 12.5,
    minutesToFull: 45,
    chargePortOpen: true,
    vehicleName: "Test Car",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    latitude: null,
    longitude: null,
    isHome: null,
  };

  let db: AppDatabase;
  let manager: VehicleManager;
  let createdAdapters: MockVehicleAdapter[];
  let caller: ReturnType<typeof createCaller>;

  const REQUEST_CONTEXT = {
    origin: "test",
    traceId: "test",
    hasSolar: false,
    hasSchedule: false,
    hasBlockout: false,
  } as const;

  const makeRegistry = (): VehiclePluginRegistry =>
    throwingMock<VehiclePluginRegistry>("VehiclePluginRegistry", {
      get: () =>
        ({
          id: "tesla",
          createMiddleware: (row: VehicleRow) => {
            const adapter = new MockVehicleAdapter(row.id, MOCK_STATE);
            createdAdapters.push(adapter);
            return Promise.resolve(
              new TeslaVehicleMiddleware(
                adapter as unknown as VehicleAdapter,
                testLogger,
              ),
            );
          },
        }) as unknown as ReturnType<VehiclePluginRegistry["get"]>,
    });

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    createdAdapters = [];

    const emitter = throwingMock<TypedEventEmitter>("TypedEventEmitter", {
      emit: () => {},
      subscribe: () => () => {},
    } as unknown as Partial<TypedEventEmitter>);
    manager = new VehicleManager(db, emitter, testLogger, makeRegistry());

    await db.upsertVehicle({
      id: VIN,
      name: "Test Car",
      adapterType: "tesla",
      priority: 1,
      config: "{}",
      mode: "auto",
    });
    const row = await db.getVehicle(VIN);
    assertExists(row);
    await manager.addVehicle(row);
    await manager.requestState(VIN, REQUEST_CONTEXT);

    const vehicleService = new VehicleService(
      db,
      manager,
      throwingMock("ConfigService"),
      emitter,
      testLogger,
    );

    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", {
      db,
      vehicleManager: manager,
      vehicleService,
      logger: testLogger,
    }));
  });

  afterEach(() => {
    db.close();
  });

  describe("vehicle.list", () => {
    it("lists configured vehicles with latest state", async () => {
      const data = await caller.vehicle.list();
      expect(data.vehicles).toHaveLength(1);
      expect(data.vehicles[0].id).toBe(VIN);
      expect(data.vehicles[0].name).toBe("Test Car");
      const state = data.vehicles[0].state;
      assertExists(state);
      expect(state.batteryLevel).toBe(72);
    });

    it("lists multiple vehicles", async () => {
      await db.upsertVehicle({
        id: VIN2,
        name: "Car 2",
        adapterType: "tesla",
        priority: 2,
        config: "{}",
        mode: "auto",
      });
      const row2 = await db.getVehicle(VIN2);
      assertExists(row2);
      await manager.addVehicle(row2);
      await manager.requestState(VIN2, REQUEST_CONTEXT);

      const data = await caller.vehicle.list();
      expect(data.vehicles).toHaveLength(2);
    });
  });

  describe("vehicle.create", () => {
    it("creates a new vehicle", async () => {
      const data = await caller.vehicle.create({
        id: VIN2,
        name: "Car 2",
        adapterType: "tesla",
      });
      expect(data.success).toBe(true);
      expect(data.vehicle.id).toBe(VIN2);

      const vehicle = await db.getVehicle(VIN2);
      assertExists(vehicle);
      expect(vehicle.name).toBe("Car 2");
    });

    it("throws CONFLICT for duplicate ID", async () => {
      await expect(
        caller.vehicle.create({
          id: VIN,
          name: "Duplicate",
          adapterType: "tesla",
        }),
      ).rejects.toThrow("Vehicle with this ID already exists");
    });
  });

  describe("vehicle.delete", () => {
    it("removes vehicle from manager and DB", async () => {
      const data = await caller.vehicle.delete({ vehicleId: VIN });
      expect(data.success).toBe(true);
      expect(await db.getVehicle(VIN)).toBeNull();
      expect(manager.hasVehicle(VIN)).toBe(false);
    });

    it("throws NOT_FOUND for unknown VIN", async () => {
      await expect(
        caller.vehicle.delete({ vehicleId: "UNKNOWN" }),
      ).rejects.toThrow("Vehicle not found");
    });
  });

  describe("vehicle.setMode", () => {
    it("updates vehicle mode", async () => {
      const data = await caller.vehicle.setMode({
        vehicleId: VIN,
        mode: "charge_now",
      });
      expect(data.success).toBe(true);
      expect(data.mode).toBe("charge_now");

      const vehicle = await db.getVehicle(VIN);
      assertExists(vehicle);
      expect(vehicle.mode).toBe("charge_now");
    });

    it("throws NOT_FOUND for unknown VIN", async () => {
      await expect(
        caller.vehicle.setMode({ vehicleId: "UNKNOWN", mode: "auto" }),
      ).rejects.toThrow("Vehicle not found");
    });
  });

  describe("vehicle.setPriority", () => {
    it("updates vehicle priority", async () => {
      const data = await caller.vehicle.setPriority({
        vehicleId: VIN,
        priority: 5,
      });
      expect(data.success).toBe(true);
      expect(data.priority).toBe(5);

      const vehicle = await db.getVehicle(VIN);
      assertExists(vehicle);
      expect(vehicle.priority).toBe(5);
    });

    it("throws NOT_FOUND for unknown VIN", async () => {
      await expect(
        caller.vehicle.setPriority({ vehicleId: "UNKNOWN", priority: 1 }),
      ).rejects.toThrow("Vehicle not found");
    });
  });

  describe("vehicle.command", () => {
    it("starts charging and returns state", async () => {
      const data = await caller.vehicle.command({
        vehicleId: VIN,
        command: "start",
      });
      expect(data.success).toBe(true);
      // startChargingAt sends setChargeAmps then startCharging
      expect(createdAdapters[0].commandCalls).toContainEqual({
        command: "setChargeAmps",
        args: 32,
      });
    });

    it("stops charging", async () => {
      const data = await caller.vehicle.command({
        vehicleId: VIN,
        command: "stop",
      });
      expect(data.success).toBe(true);
      expect(createdAdapters[0].commandCalls).toContainEqual({
        command: "stopCharging",
      });
    });

    it("wakes vehicle by force-refreshing state", async () => {
      const data = await caller.vehicle.command({
        vehicleId: VIN,
        command: "wake",
      });
      expect(data.success).toBe(true);
      assertExists(data.state);
      expect(data.state.vehicleId).toBe(VIN);
    });

    it("throws NOT_FOUND for unknown VIN", async () => {
      await expect(
        caller.vehicle.command({ vehicleId: "UNKNOWN", command: "start" }),
      ).rejects.toThrow("Vehicle not found");
    });
  });

  describe("vehicle.setAmps", () => {
    it("sets charge amps", async () => {
      const data = await caller.vehicle.setAmps({
        vehicleId: VIN,
        amps: 24,
      });
      expect(data.success).toBe(true);
      expect(createdAdapters[0].commandCalls).toContainEqual({
        command: "setChargeAmps",
        args: 24,
      });
    });

    it("throws NOT_FOUND for unknown VIN", async () => {
      await expect(
        caller.vehicle.setAmps({ vehicleId: "UNKNOWN", amps: 16 }),
      ).rejects.toThrow("Vehicle not found");
    });
  });
});
