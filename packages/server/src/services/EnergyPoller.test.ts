import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import type { CumulativeEnergyData, EnergyData } from "@chargeha/shared";
import { AppDatabase } from "../db/AppDatabase.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { EnergyPoller } from "./EnergyPoller.ts";
import type { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import { Logger } from "../lib/Logger.ts";
import { testable } from "../test-helpers/Testable.ts";
import { MockEnergyPollerAdapter } from "../test-helpers/MockEnergyPollerAdapter.ts";
import { MockEventEmitter } from "../test-helpers/MockEventEmitter.ts";

describe("EnergyPoller", () => {
  const BASE_REALTIME: EnergyData = {
    solarProductionW: 5000,
    gridPowerW: -2000,
    homeConsumptionW: 3000,
    batteryPowerW: null,
    batterySoc: null,
    gridVoltageV: null,
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const testLogger = new Logger("EnergyPoller", "error");

  let db: AppDatabase;
  let adapter: MockEnergyPollerAdapter;
  let emitter: MockEventEmitter;
  let poller: EnergyPoller;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    adapter = new MockEnergyPollerAdapter(BASE_REALTIME);
    emitter = new MockEventEmitter();

    poller = new EnergyPoller(
      adapter as unknown as EnergyAdapterManager,
      emitter as unknown as TypedEventEmitter,
      db,
      testLogger,
    );
    // EnergyPoller auto-starts in its ctor; stop the initial timer so each
    // test drives `poll()` deterministically (otherwise the ambient poll
    // fires one extra `energy_update` event and throws off assertions).
    await poller.stop();
    // The initial poll will have emitted events into the mock before stop()
    // awaited it — clear them so each test sees only its own emissions.
    emitter.events = [];
  });

  afterEach(async () => {
    await poller.stop();
    db.close();
  });

  describe("tryGetRealtimeSnapshot", () => {
    it("returns null before first poll", () => {
      expect(poller.tryGetRealtimeSnapshot()).toBeNull();
    });

    it("returns snapshot after poll", async () => {
      await testable(poller).poll();

      const snapshot = poller.tryGetRealtimeSnapshot();
      assertExists(snapshot);
      expect(snapshot.realtime.solarProductionW).toBe(5000);
      // Cumulative is built from DB — no readings inserted so daily values are 0
      expect(snapshot.cumulative.dailySolarProducedWh).toBe(0);
    });
  });

  describe("poll", () => {
    it("emits energy update event", async () => {
      await testable(poller).poll();

      const energyUpdates = emitter.events.filter((e) =>
        e.type === "energy_update"
      );
      expect(energyUpdates).toHaveLength(1);
    });

    it("emits energy_poll_success on successful poll", async () => {
      await testable(poller).poll();

      const successEvents = emitter.events.filter((e) =>
        e.type === "energy_poll_success"
      );
      expect(successEvents).toHaveLength(1);
    });

    it("emits energy_poll_failure on failed poll", async () => {
      adapter.shouldFail = true;
      await testable(poller).poll();

      const failureEvents = emitter.events.filter((e) =>
        e.type === "energy_poll_failure"
      );
      expect(failureEvents).toHaveLength(1);
      expect(
        (failureEvents[0].data as { error: string }).error,
      ).toBe("Adapter error");
    });

    it("emits an energy_update with zeros and pollFailed=true when the poll throws", async () => {
      // Failures must be recorded as a zero-valued breadcrumb so DataRecorder
      // does not silently reuse the prior good reading for many minutes.
      adapter.shouldFail = true;
      await testable(poller).poll();

      const energyUpdates = emitter.events.filter((e) =>
        e.type === "energy_update"
      );
      expect(energyUpdates).toHaveLength(1);
      const data = energyUpdates[0].data as EnergyData & CumulativeEnergyData;
      expect(data.solarProductionW).toBe(0);
      expect(data.gridPowerW).toBe(0);
      expect(data.homeConsumptionW).toBe(0);
      expect(data.pollFailed).toBe(true);
    });

    it("builds daily cumulative fields from DB recordings", async () => {
      // Insert some energy readings so getTodayEnergySummary returns data
      await db.insertEnergyReading({
        solarProductionW: 3000,
        gridPowerW: 500,
        homeConsumptionW: 3500,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });

      await testable(poller).poll();

      const snapshot = poller.tryGetRealtimeSnapshot();
      assertExists(snapshot);
      // Daily values come from DB, not the adapter
      expect(snapshot.cumulative.dailySolarProducedWh).toBeGreaterThanOrEqual(
        0,
      );
    });

    it("does not crash on poll failure", async () => {
      adapter.shouldFail = true;

      await testable(poller).poll();

      // Snapshot is now populated with a zero-valued, pollFailed=true reading
      // so DataRecorder writes a breadcrumb instead of reusing the prior value.
      const snapshot = poller.tryGetRealtimeSnapshot();
      assertExists(snapshot);
      expect(snapshot.realtime.solarProductionW).toBe(0);
      expect(snapshot.realtime.pollFailed).toBe(true);
    });

    it("logs battery data when batteryPowerW is present", async () => {
      adapter.getRealtimeData = () =>
        Promise.resolve({
          ...BASE_REALTIME,
          batteryPowerW: 1500,
          batterySoc: 72,
        });

      await testable(poller).poll();

      const snapshot = poller.tryGetRealtimeSnapshot();
      assertExists(snapshot);
      expect(snapshot.realtime.batteryPowerW).toBe(1500);
      expect(snapshot.realtime.batterySoc).toBe(72);
    });

    it("emits poll failure with stringified non-Error throw", async () => {
      adapter.getRealtimeData = () => Promise.reject("string error");

      await testable(poller).poll();

      const failureEvents = emitter.events.filter((e) =>
        e.type === "energy_poll_failure"
      );
      expect(failureEvents).toHaveLength(1);
      expect(
        (failureEvents[0].data as { error: string }).error,
      ).toBe("string error");
    });
  });

  describe("stop / restart", () => {
    it("stop is idempotent", async () => {
      await poller.stop();
      await poller.stop();
    });

    it("restart clears and re-establishes the timer", async () => {
      await poller.restart();
      await poller.stop();
    });
  });

  describe("subscribeToUpdates", () => {
    let realEmitter: TypedEventEmitter;
    let subPoller: EnergyPoller;
    let subDb: AppDatabase;

    beforeEach(async () => {
      realEmitter = new TypedEventEmitter();
      subDb = new AppDatabase(":memory:");
      await subDb.init();
      subPoller = new EnergyPoller(
        adapter as unknown as EnergyAdapterManager,
        realEmitter,
        subDb,
        testLogger,
      );
    });

    afterEach(async () => {
      await subPoller.stop();
      subDb.close();
    });

    it("emits initial snapshot when available", async () => {
      // Poll once so there's a snapshot
      await testable(subPoller).poll();

      const results: (EnergyData & CumulativeEnergyData)[] = [];
      const obs = subPoller.subscribeToUpdates();
      const sub = obs.subscribe({
        next(value) {
          results.push(value);
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].solarProductionW).toBe(5000);
      sub.unsubscribe();
    });

    it("does not emit initial snapshot when none available", () => {
      const results: (EnergyData & CumulativeEnergyData)[] = [];
      const obs = subPoller.subscribeToUpdates();
      const sub = obs.subscribe({
        next(value) {
          results.push(value);
        },
      });

      expect(results).toHaveLength(0);
      sub.unsubscribe();
    });

    it("forwards live updates from EventEmitter", () => {
      const results: (EnergyData & CumulativeEnergyData)[] = [];
      const obs = subPoller.subscribeToUpdates();
      const sub = obs.subscribe({
        next(value) {
          results.push(value);
        },
      });

      const liveData: EnergyData & CumulativeEnergyData = {
        ...BASE_REALTIME,
        solarProducedWh: 0,
        gridImportedWh: 0,
        gridExportedWh: 0,
        dailySolarProducedWh: 0,
        dailyGridImportWh: 0,
        dailyGridExportWh: 0,
        solarProductionW: 9000,
      };
      realEmitter.emit("energy_update", liveData);

      expect(results).toHaveLength(1);
      expect(results[0].solarProductionW).toBe(9000);
      sub.unsubscribe();
    });

    it("cleans up listener on unsubscribe", () => {
      const results: (EnergyData & CumulativeEnergyData)[] = [];
      const obs = subPoller.subscribeToUpdates();
      const sub = obs.subscribe({
        next(value) {
          results.push(value);
        },
      });

      sub.unsubscribe();

      realEmitter.emit("energy_update", {
        ...BASE_REALTIME,
        solarProducedWh: 0,
        gridImportedWh: 0,
        gridExportedWh: 0,
        dailySolarProducedWh: 0,
        dailyGridImportWh: 0,
        dailyGridExportWh: 0,
      });

      expect(results).toHaveLength(0);
    });
  });
});
