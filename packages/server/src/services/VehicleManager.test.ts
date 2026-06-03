import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertEquals, assertExists } from "@std/assert";
import type { VehicleChargeState } from "@chargeha/shared";
import type { VehicleRow } from "../db/types.ts";
import { AppDatabase } from "../db/AppDatabase.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { VehicleManager } from "./VehicleManager.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { VehicleRequestContext } from "@chargeha/plugins/types";
import { Logger } from "../lib/Logger.ts";
import { MockMiddleware } from "../test-helpers/MockMiddleware.ts";
import { MockEventEmitter } from "../test-helpers/MockEventEmitter.ts";

describe("VehicleManager", () => {
  const testLogger = new Logger("VehicleManager", "error");

  const MOCK_STATE: VehicleChargeState = {
    vehicleId: "VIN1",
    batteryLevel: 72,
    chargeLimit: 80,
    isCharging: false,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps: 16,
    chargeAmpsMax: 32,
    chargeAmpsMin: 5,
    chargePowerKw: 0,
    chargerVoltage: 240,
    chargerPhases: 1,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: false,
    vehicleName: "Test Car",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    latitude: null,
    longitude: null,
    isHome: null,
  };

  const VEHICLE_ROW: VehicleRow = {
    id: "VIN1",
    name: "Test Car",
    adapterType: "tesla",
    priority: 1,
    config: "{}",
    mode: "auto",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  };

  let db: AppDatabase;
  let emitter: MockEventEmitter;
  let middlewares: Map<string, MockMiddleware>;
  let manager: VehicleManager;

  /** Build a plugin registry that returns a MockMiddleware per vehicle row. */
  function makeRegistry(): VehiclePluginRegistry {
    return {
      get: () => ({
        id: "tesla",
        createMiddleware: (row: VehicleRow) => {
          const mw = new MockMiddleware(MOCK_STATE);
          mw.nextState = { ...MOCK_STATE, vehicleId: row.id };
          middlewares.set(row.id, mw);
          return Promise.resolve(mw);
        },
      }),
    } as unknown as VehiclePluginRegistry;
  }

  const REQUEST_CONTEXT: VehicleRequestContext = {
    origin: "test",
    traceId: "test",
    hasSolar: false,
    hasSchedule: false,
    hasBlockout: false,
  };

  const CMD_CTX = { origin: "test", traceId: "test" };

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    emitter = new MockEventEmitter();
    middlewares = new Map();
    manager = new VehicleManager(
      db,
      emitter as unknown as TypedEventEmitter,
      testLogger,
      makeRegistry(),
    );
  });

  afterEach(() => {
    db.close();
  });

  describe("addVehicle", () => {
    it("creates middleware for a vehicle row", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      expect(middlewares.has("VIN1")).toBe(true);
      expect(manager.hasVehicle("VIN1")).toBe(true);
    });

    it("is idempotent on duplicate IDs", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.addVehicle(VEHICLE_ROW);
      expect(middlewares.size).toBe(1);
      expect(manager.hasVehicle("VIN1")).toBe(true);
    });
  });

  describe("removeVehicle", () => {
    it("removes vehicle from registry", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.removeVehicle("VIN1");
      expect(manager.hasVehicle("VIN1")).toBe(false);
    });

    it("is a no-op for unknown vehicle ID", async () => {
      await manager.removeVehicle("UNKNOWN");
    });
  });

  describe("deleteVehicle", () => {
    it("removes live state, deletes the row, cascades schedules, resequences", async () => {
      await db.upsertVehicle({
        id: "VIN1",
        name: "Car 1",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });
      await db.upsertVehicle({
        id: "VIN2",
        name: "Car 2",
        adapterType: "tesla",
        priority: 2,
        config: "{}",
        mode: "auto",
      });
      await db.createSchedule({
        id: "sched-1",
        vehicleId: "VIN1",
        scheduleType: "charge",
        startTime: "22:00",
        endTime: "06:00",
        days: ["mon"],
        chargeAmps: 16,
        chargeLimitPct: 80,
      });
      await manager.addVehicle(VEHICLE_ROW);

      await manager.deleteVehicle("VIN1");

      expect(manager.hasVehicle("VIN1")).toBe(false);
      expect(await db.getVehicle("VIN1")).toBeNull();
      expect(await db.getSchedules()).toHaveLength(0);

      const remaining = await db.getVehicle("VIN2");
      expect(remaining?.priority).toBe(1);
    });
  });

  describe("requestState", () => {
    it("returns null for unknown vehicle", async () => {
      const state = await manager.requestState("UNKNOWN", REQUEST_CONTEXT);
      expect(state).toBeNull();
    });

    it("delegates to middleware and returns state", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      const state = await manager.requestState("VIN1", REQUEST_CONTEXT);
      assertExists(state);
      expect(state.vehicleId).toBe("VIN1");
      expect(middlewares.get("VIN1")?.requestStateCalls).toHaveLength(1);
    });

    it("emits vehicle_update on success", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const updateEvents = emitter.events.filter((e) =>
        e.type === "vehicle_update"
      );
      expect(updateEvents).toHaveLength(1);
    });

    it("reports error when middleware throws", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      const mw = middlewares.get("VIN1");
      assertExists(mw);
      mw.requestStateImpl = () => Promise.reject(new Error("API failure"));

      await manager.requestState("VIN1", REQUEST_CONTEXT);

      const err = manager.getVehicleError("VIN1");
      expect(err?.message).toBe("API failure");
    });

    it("clears fetch errors on successful request", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      manager.reportVehicleError("VIN1", "Test Car", "old error", "fetch");
      expect(manager.getVehicleError("VIN1")).not.toBeNull();

      await manager.requestState("VIN1", REQUEST_CONTEXT);
      expect(manager.getVehicleError("VIN1")).toBeNull();
    });

    it("does not clear command errors on successful request", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      manager.reportVehicleError("VIN1", "Test Car", "cmd error", "command");

      await manager.requestState("VIN1", REQUEST_CONTEXT);
      expect(manager.getVehicleError("VIN1")?.message).toBe("cmd error");
    });

    it("detects plug-in transition and emits vehicle_plug_changed", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      // First request initializes the tracker (no event)
      mw.nextState = { ...MOCK_STATE, isPluggedIn: false };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      // Second request — plug in
      mw.nextState = { ...MOCK_STATE, isPluggedIn: true };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      const plugEvents = emitter.events.filter((e) =>
        e.type === "vehicle_plug_changed"
      );
      expect(plugEvents).toHaveLength(1);
      assertEquals(plugEvents[0].type, "vehicle_plug_changed");
      expect((plugEvents[0].data as { isPluggedIn: boolean }).isPluggedIn).toBe(
        true,
      );
    });

    it("detects plug-out transition and emits vehicle_plug_changed", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      mw.nextState = { ...MOCK_STATE, isPluggedIn: true };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      mw.nextState = { ...MOCK_STATE, isPluggedIn: false };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      const plugEvents = emitter.events.filter((e) =>
        e.type === "vehicle_plug_changed"
      );
      expect(plugEvents).toHaveLength(1);
      assertEquals(plugEvents[0].type, "vehicle_plug_changed");
      expect((plugEvents[0].data as { isPluggedIn: boolean }).isPluggedIn).toBe(
        false,
      );
    });

    it("does not fire plug transition on first request (server restart)", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      mw.nextState = { ...MOCK_STATE, isPluggedIn: true };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      const plugEvents = emitter.events.filter((e) =>
        e.type === "vehicle_plug_changed"
      );
      expect(plugEvents).toHaveLength(0);
    });

    it("does not emit vehicle_arrived_home on first sample at home (server restart)", async () => {
      // isHome is recomputed from lat/lng vs configured home coords (geo.ts),
      // so we configure both rather than setting isHome directly on the mock.
      await db.setConfig("home_latitude", "0");
      await db.setConfig("home_longitude", "0");
      await manager.addVehicle(VEHICLE_ROW);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      mw.nextState = { ...MOCK_STATE, latitude: 0, longitude: 0 };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      const arrived = emitter.events.filter((e) =>
        e.type === "vehicle_arrived_home"
      );
      expect(arrived).toHaveLength(0);
    });

    it("emits vehicle_arrived_home on isHome false → true transition", async () => {
      await db.setConfig("home_latitude", "0");
      await db.setConfig("home_longitude", "0");
      await manager.addVehicle(VEHICLE_ROW);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      // Far away (~111km north of home) → isHome=false
      mw.nextState = { ...MOCK_STATE, latitude: 1, longitude: 0 };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      // Back at home coords → isHome=true
      mw.nextState = {
        ...MOCK_STATE,
        latitude: 0,
        longitude: 0,
        isPluggedIn: false,
        batteryLevel: 55,
      };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      const arrived = emitter.events.filter((e) =>
        e.type === "vehicle_arrived_home"
      );
      expect(arrived).toHaveLength(1);
      const data = arrived[0].data as {
        vehicleId: string;
        soc: number;
        isPluggedIn: boolean;
        chargeLimit: number;
      };
      expect(data.vehicleId).toBe("VIN1");
      expect(data.soc).toBe(55);
      expect(data.isPluggedIn).toBe(false);
      expect(data.chargeLimit).toBe(80); // from MOCK_STATE
    });

    it("does not emit vehicle_arrived_home on isHome null → true (location became known)", async () => {
      // Strict false→true check — null (location unknown) is not treated as
      // "away", so transitioning from null to true is not an arrival event.
      await db.setConfig("home_latitude", "0");
      await db.setConfig("home_longitude", "0");
      await manager.addVehicle(VEHICLE_ROW);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      // No vehicle location → isHome=null
      mw.nextState = { ...MOCK_STATE, latitude: null, longitude: null };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      // Now at home → isHome=true (but previous was null, not false)
      mw.nextState = { ...MOCK_STATE, latitude: 0, longitude: 0 };
      await manager.requestState("VIN1", REQUEST_CONTEXT);

      const arrived = emitter.events.filter((e) =>
        e.type === "vehicle_arrived_home"
      );
      expect(arrived).toHaveLength(0);
    });
  });

  describe("getState / getAllStates / isVehicleAwake", () => {
    it("getState returns null before request", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      expect(await manager.getState("VIN1")).toBeNull();
    });

    it("getState returns null for unknown vehicle", async () => {
      expect(await manager.getState("UNKNOWN")).toBeNull();
    });

    it("getState returns cached state after request", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const state = await manager.getState("VIN1");
      assertExists(state);
      expect(state.vehicleId).toBe("VIN1");
    });

    it("getAllStates returns map of all cached states", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.addVehicle({ ...VEHICLE_ROW, id: "VIN2", name: "Car 2" });

      await manager.requestState("VIN1", REQUEST_CONTEXT);
      await manager.requestState("VIN2", REQUEST_CONTEXT);

      const states = await manager.getAllStates();
      expect(states.size).toBe(2);
    });

    it("isVehicleAwake returns middleware online", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      expect(manager.isVehicleAwake("VIN1")).toBe(true);
    });

    it("isVehicleAwake returns false for unknown vehicle", () => {
      expect(manager.isVehicleAwake("UNKNOWN")).toBe(false);
    });
  });

  describe("startChargingAt", () => {
    it("returns error for unknown vehicle", async () => {
      const result = await manager.startChargingAt(
        "UNKNOWN",
        20,
        CMD_CTX,
        MOCK_STATE,
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Vehicle not registered");
    });

    it("clamps amps to [min, max]", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      await manager.startChargingAt(
        "VIN1",
        100,
        CMD_CTX,
        { ...MOCK_STATE, chargeAmps: 0, isCharging: false },
      );
      expect(mw.setAmpsCalls.at(-1)?.amps).toBe(32);
    });

    it("sends start when not charging", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      const result = await manager.startChargingAt(
        "VIN1",
        16,
        CMD_CTX,
        { ...MOCK_STATE, isCharging: false },
      );
      expect(result.success).toBe(true);
      expect(mw.startCalls).toHaveLength(1);
    });

    it("skips start when already charging at target amps", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      await manager.startChargingAt(
        "VIN1",
        16,
        CMD_CTX,
        { ...MOCK_STATE, isCharging: true, chargeAmps: 16 },
      );
      expect(mw.startCalls).toHaveLength(0);
      expect(mw.setAmpsCalls).toHaveLength(0);
    });

    it("honours command backoff", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      // Trigger failure to produce backoff — state has chargeAmps=0 so
      // setChargeAmps will be called, and it's set to fail.
      const startState = { ...MOCK_STATE, chargeAmps: 0, isCharging: false };
      mw.setAmpsResult = false;
      await manager.startChargingAt("VIN1", 16, CMD_CTX, startState);

      // Second call with non-force should be blocked
      mw.setAmpsResult = true;
      mw.startCalls = [];
      const result = await manager.startChargingAt(
        "VIN1",
        16,
        CMD_CTX,
        startState,
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Command backoff active");
    });

    it("bypasses backoff when force=true", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      const startState = { ...MOCK_STATE, chargeAmps: 0, isCharging: false };
      mw.setAmpsResult = false;
      await manager.startChargingAt("VIN1", 16, CMD_CTX, startState);

      mw.setAmpsResult = true;
      const result = await manager.startChargingAt(
        "VIN1",
        16,
        CMD_CTX,
        startState,
        { force: true },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("stopCharging", () => {
    it("returns error for unknown vehicle", async () => {
      const result = await manager.stopCharging(
        "UNKNOWN",
        CMD_CTX,
        MOCK_STATE,
      );
      expect(result.success).toBe(false);
    });

    it("is idempotent when not charging", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      const result = await manager.stopCharging(
        "VIN1",
        CMD_CTX,
        { ...MOCK_STATE, isCharging: false },
      );
      expect(result.success).toBe(true);
      expect(mw.stopCalls).toHaveLength(0);
    });

    it("sends stop when charging", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.requestState("VIN1", REQUEST_CONTEXT);
      const mw = middlewares.get("VIN1");
      assertExists(mw);

      const result = await manager.stopCharging(
        "VIN1",
        CMD_CTX,
        { ...MOCK_STATE, isCharging: true },
      );
      expect(result.success).toBe(true);
      expect(mw.stopCalls).toHaveLength(1);
    });
  });

  describe("error tracking", () => {
    it("reportVehicleError stores and emits", () => {
      manager.reportVehicleError("VIN1", "Test", "oops", "fetch");
      expect(manager.getVehicleError("VIN1")?.message).toBe("oops");
      expect(
        emitter.events.some((e) => e.type === "vehicle_error"),
      ).toBe(true);
    });

    it("clearVehicleError removes error and emits with null", () => {
      manager.reportVehicleError("VIN1", "Test", "oops");
      emitter.events.length = 0;

      manager.clearVehicleError("VIN1");
      expect(manager.getVehicleError("VIN1")).toBeNull();
      const clearEvent = emitter.events.find((e) => e.type === "vehicle_error");
      assertExists(clearEvent);
      expect((clearEvent.data as { error: string | null }).error).toBeNull();
    });

    it("clearVehicleError is a no-op when no error exists", () => {
      manager.clearVehicleError("VIN1");
      expect(
        emitter.events.some((e) => e.type === "vehicle_error"),
      ).toBe(false);
    });

    it("getVehicleError returns null for unknown vehicle", () => {
      expect(manager.getVehicleError("UNKNOWN")).toBeNull();
    });

    it("removeVehicle clears stored error", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      manager.reportVehicleError("VIN1", "Test", "oops");
      await manager.removeVehicle("VIN1");
      expect(manager.getVehicleError("VIN1")).toBeNull();
    });
  });

  describe("subscribeToUpdates", () => {
    let realEmitter: TypedEventEmitter;
    let subDb: AppDatabase;
    let subManager: VehicleManager;

    beforeEach(async () => {
      realEmitter = new TypedEventEmitter();
      subDb = new AppDatabase(":memory:");
      await subDb.init();
      subManager = new VehicleManager(
        subDb,
        realEmitter,
        testLogger,
        makeRegistry(),
      );
    });

    afterEach(() => {
      subDb.close();
    });

    it("emits initial cached states", async () => {
      await subManager.addVehicle(VEHICLE_ROW);
      await subManager.requestState("VIN1", REQUEST_CONTEXT);

      const received: VehicleChargeState[] = [];
      const observable = subManager.subscribeToUpdates();
      const sub = observable.subscribe({
        next: (state) => received.push(state),
      });

      // Initial cached states are emitted asynchronously since getAllStates is async.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(received).toHaveLength(1);
      expect(received[0].vehicleId).toBe("VIN1");
      sub.unsubscribe();
    });

    it("forwards live vehicle_update events", () => {
      const received: VehicleChargeState[] = [];
      const observable = subManager.subscribeToUpdates();
      const sub = observable.subscribe({
        next: (state) => received.push(state),
      });

      realEmitter.emit("vehicle_update", MOCK_STATE);
      expect(received).toHaveLength(1);
      sub.unsubscribe();
    });

    it("cleans up listener on unsubscribe", () => {
      const received: VehicleChargeState[] = [];
      const observable = subManager.subscribeToUpdates();
      const sub = observable.subscribe({
        next: (state) => received.push(state),
      });
      sub.unsubscribe();

      realEmitter.emit("vehicle_update", MOCK_STATE);
      expect(received).toHaveLength(0);
    });
  });

  describe("subscribeToErrors", () => {
    let realEmitter: TypedEventEmitter;
    let errDb: AppDatabase;
    let errManager: VehicleManager;

    beforeEach(async () => {
      realEmitter = new TypedEventEmitter();
      errDb = new AppDatabase(":memory:");
      await errDb.init();
      errManager = new VehicleManager(
        errDb,
        realEmitter,
        testLogger,
        makeRegistry(),
      );
    });

    afterEach(() => {
      errDb.close();
    });

    it("emits initial errors for vehicles with existing errors", () => {
      errManager.reportVehicleError("VIN1", "Car", "boom");

      const received: Array<{ vehicleId: string; error: string | null }> = [];
      const sub = errManager.subscribeToErrors().subscribe({
        next: (data) =>
          received.push({ vehicleId: data.vehicleId, error: data.error }),
      });

      expect(received).toHaveLength(1);
      expect(received[0].error).toBe("boom");
      sub.unsubscribe();
    });

    it("forwards live vehicle_error events", () => {
      const received: Array<{ vehicleId: string; error: string | null }> = [];
      const sub = errManager.subscribeToErrors().subscribe({
        next: (data) =>
          received.push({ vehicleId: data.vehicleId, error: data.error }),
      });

      realEmitter.emit("vehicle_error", {
        vehicleId: "VIN1",
        vehicleName: "Car",
        error: "live err",
        source: "fetch",
      });

      expect(received).toHaveLength(1);
      sub.unsubscribe();
    });
  });

  describe("addVehicle seeding", () => {
    it("seeds cached state from a recent controller log", async () => {
      await db.insertControllerLogEntries([{
        vehicleId: "VIN1",
        vehicleName: "Test Car",
        mode: "auto",
        inputsJson: JSON.stringify({
          vehicleState: {
            batteryLevel: 65,
            chargeLimit: 80,
            isCharging: false,
            isPluggedIn: true,
            chargeAmps: 5,
            chargeAmpsMax: 32,
            chargeAmpsMin: 5,
          },
        }),
        checksJson: "[]",
        action: "none",
        actionDetail: "Idle",
        targetAmps: null,
        traceId: "test",
      }]);

      await manager.addVehicle(VEHICLE_ROW);

      const mw = middlewares.get("VIN1");
      assertExists(mw);
      expect(mw.requestStateCalls).toHaveLength(0);
      const state = await manager.getState("VIN1");
      assertExists(state);
      expect(state.batteryLevel).toBe(65);
    });

    it("does not throw when the log read fails", async () => {
      const originalGet = db.getLastControllerLogPerVehicle.bind(db);
      db.getLastControllerLogPerVehicle = () =>
        Promise.reject(new Error("db down"));
      try {
        await manager.addVehicle(VEHICLE_ROW);
        expect(manager.hasVehicle("VIN1")).toBe(true);
      } finally {
        db.getLastControllerLogPerVehicle = originalGet;
      }
    });
  });

  describe("getVehicleIds / hasVehicle", () => {
    it("returns all registered IDs", async () => {
      await manager.addVehicle(VEHICLE_ROW);
      await manager.addVehicle({ ...VEHICLE_ROW, id: "VIN2" });
      const ids = manager.getVehicleIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain("VIN1");
      expect(ids).toContain("VIN2");
    });

    it("hasVehicle reflects registration state", async () => {
      expect(manager.hasVehicle("VIN1")).toBe(false);
      await manager.addVehicle(VEHICLE_ROW);
      expect(manager.hasVehicle("VIN1")).toBe(true);
    });
  });
});
