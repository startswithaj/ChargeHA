import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { ControllerAction } from "@chargeha/shared";
import { AppDatabase } from "../db/AppDatabase.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { EventMap } from "./TypedEventEmitter.ts";
import { Overseer } from "./Overseer.ts";
import { Logger } from "../lib/Logger.ts";
import { testable } from "../test-helpers/Testable.ts";

describe("Overseer", () => {
  const testLogger = new Logger("Overseer", "error");

  let db: AppDatabase;
  let eventEmitter: TypedEventEmitter;
  let safetyTrips: Array<EventMap["safety_trip"]>;
  let overseer: Overseer;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    eventEmitter = new TypedEventEmitter();
    safetyTrips = [];
    eventEmitter.subscribe("safety_trip", (data) => safetyTrips.push(data));
    overseer = new Overseer(db, eventEmitter, testLogger);
  });

  afterEach(() => {
    overseer.stop();
    db.close();
  });

  // Helper to seed controller logs with start/stop transitions
  async function seedStateChanges(
    vehicleId: string,
    vehicleName: string,
    actions: ControllerAction[],
  ): Promise<void> {
    await actions.reduce(async (prev, action) => {
      await prev;
      await db.insertControllerLogEntries([{
        vehicleId,
        vehicleName,
        mode: "auto",
        inputsJson: "{}",
        checksJson: "{}",
        action,
        actionDetail: `${action} charging`,
        targetAmps: null,
        traceId: "test",
      }]);
    }, Promise.resolve());
  }

  describe("check (oscillation detection)", () => {
    it("does nothing when no state changes exist", async () => {
      await testable(overseer).check();
      expect(safetyTrips).toHaveLength(0);
    });

    it("does nothing when transitions are within limit", async () => {
      await seedStateChanges("VIN1", "Car 1", ["start", "stop", "start"]);

      await testable(overseer).check();
      expect(safetyTrips).toHaveLength(0);

      // Charging should still be enabled
      const enabled = await db.getConfig("charging_enabled");
      expect(enabled).toBeNull(); // not set means default true
    });

    it("trips when transitions exceed limit and last action is stop", async () => {
      // More than 3 transitions, ending on stop so vehicle is already stopped
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);

      await testable(overseer).check();

      // Should have disabled charging
      const enabled = await db.getConfig("charging_enabled");
      expect(enabled).toBe("false");

      // Should have set system alert
      const alertRaw = await db.getConfig("system_alert");
      assertExists(alertRaw);
      const alert = JSON.parse(alertRaw);
      expect(alert.vehicleId).toBe("VIN1");
      expect(alert.vehicleName).toBe("Car 1");

      // Should have emitted safety_trip event
      expect(safetyTrips).toHaveLength(1);
      expect(safetyTrips[0].vehicleId).toBe("VIN1");
      expect(safetyTrips[0].vehicleName).toBe("Car 1");
      expect(safetyTrips[0].cycles).toBeGreaterThan(0);
    });

    it("does not trip when transitions exceed limit but last action is start", async () => {
      // Oscillating but vehicle is currently charging — wait for it to stop
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
      ]);

      await testable(overseer).check();

      // Should NOT have disabled charging — vehicle is still charging
      const enabled = await db.getConfig("charging_enabled");
      expect(enabled).toBeNull();
      expect(safetyTrips).toHaveLength(0);
    });

    it("only trips once per check even with multiple oscillating vehicles", async () => {
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);
      await seedStateChanges("VIN2", "Car 2", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);

      await testable(overseer).check();

      // Should only send one notification (trips on first vehicle, then returns)
      expect(safetyTrips).toHaveLength(1);
    });

    it("does not re-trip on same transitions after re-enabling charging", async () => {
      // Oscillation triggers a trip
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);
      await testable(overseer).check();
      expect(await db.getConfig("charging_enabled")).toBe("false");
      expect(safetyTrips).toHaveLength(1);

      // User re-enables charging from Settings
      await db.setConfig("charging_enabled", "true");

      // Next check should NOT re-trip — same transitions are before the trip timestamp
      await testable(overseer).check();
      expect(await db.getConfig("charging_enabled")).toBe("true");
      expect(safetyTrips).toHaveLength(1); // no new notification
    });

    it("trips again if new oscillation occurs after re-enable", async () => {
      // First oscillation + trip
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);
      await testable(overseer).check();
      expect(await db.getConfig("charging_enabled")).toBe("false");

      // User re-enables charging
      await db.setConfig("charging_enabled", "true");

      // Backdate the trip marker so new entries (at datetime('now')) come after it.
      // In production there's always a real time gap; in tests everything is
      // within the same second.
      await db.setConfig("oscillation_trip_at", "2000-01-01 00:00:00");

      // New oscillation after re-enable
      await seedStateChanges("VIN1", "Car 1", [
        "start",
        "stop",
        "start",
        "stop",
        "start",
        "stop",
      ]);
      await testable(overseer).check();

      // Should trip again on the new transitions
      expect(await db.getConfig("charging_enabled")).toBe("false");
      expect(safetyTrips).toHaveLength(2);
    });

    it("logs error when check throws", async () => {
      const original = db.getRecentStateChanges;
      db.getRecentStateChanges = () => Promise.reject(new Error("db failure"));
      try {
        await testable(overseer).check();
        // Should not throw — error is caught internally
        expect(safetyTrips).toHaveLength(0);
      } finally {
        db.getRecentStateChanges = original;
      }
    });
  });
});
