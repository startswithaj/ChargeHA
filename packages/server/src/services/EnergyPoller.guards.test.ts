import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { buildEnergyData } from "@chargeha/shared/test-factories";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargingPointManager } from "./ChargingPointManager.ts";
import { EnergyPoller } from "./EnergyPoller.ts";
import { TypedEventEmitter } from "./TypedEventEmitter.ts";
import { Logger } from "../lib/Logger.ts";
import { MockEnergyPollerAdapter } from "../test-helpers/MockEnergyPollerAdapter.ts";
import { throwingMock } from "../test-helpers/throwingMock.ts";
import { stub } from "@std/testing/mock";
import { testable } from "../test-helpers/Testable.ts";

describe("Energy poll scheduling guards", () => {
  let time: FakeTime;
  let adapter: MockEnergyPollerAdapter;
  let emitter: TypedEventEmitter;
  let poller: EnergyPoller;
  let events: string[];
  const sample = () => buildEnergyData();
  const create = () =>
    new EnergyPoller(
      adapter.asManager(),
      throwingMock<ChargingPointManager>("ChargingPointManager", {
        getChargingLoadW: () => Promise.resolve({ meteredW: 0, unmeteredW: 0 }),
      }),
      emitter,
      throwingMock<AppDatabase>("AppDatabase", {
        getConfig: () => Promise.resolve("UTC"),
        getTodayEnergySummary: () =>
          Promise.resolve({ solarWh: 0, gridImportWh: 0, gridExportWh: 0 }),
      }),
      new Logger("PollerGuards", "error"),
    );
  beforeEach(async () => {
    time = new FakeTime();
    adapter = new MockEnergyPollerAdapter(sample());
    adapter.deferred = true;
    emitter = new TypedEventEmitter();
    events = [];
    emitter.subscribe("energy_update", () => events.push("update"));
    emitter.subscribe("energy_poll_success", () => events.push("success"));
    emitter.subscribe("energy_poll_failure", () => events.push("failure"));
    poller = create();
    await adapter.waitForRead(1);
  });
  afterEach(async () => {
    const stopping = poller.stop();
    adapter.reads.forEach((read) => read.resolve(sample()));

    await stopping;
    time.restore();
  });

  it("never overlaps and waits a full ordinary interval after success or failure", async () => {
    time.tick(120_000);

    expect(adapter.reads).toHaveLength(1);

    const first = testable(poller).polling;

    adapter.reads[0].reject(new Error("offline"));
    await first;

    expect(poller.getRealtimeSnapshot().realtime.pollFailed).toBe(true);

    time.tick(9999);

    expect(adapter.reads).toHaveLength(1);

    time.tick(1);
    await adapter.waitForRead(2);

    const second = testable(poller).polling;

    adapter.reads[1].resolve(sample());
    await second;
    time.tick(9999);

    expect(adapter.reads).toHaveLength(2);

    time.tick(1);
    await adapter.waitForRead(3);

    expect(adapter.reads[2].signal).toBe(adapter.reads[1].signal);
  });

  it("cancels and drains late success without rescheduling", async () => {
    const stopping = poller.stop();

    expect(adapter.reads[0].signal?.aborted).toBe(true);

    const drained = { value: false };
    void stopping.then(() => drained.value = true);

    await Promise.resolve();

    expect(drained.value).toBe(false);

    adapter.reads[0].resolve(sample());
    await stopping;

    expect(drained.value).toBe(true);
    expect(poller.tryGetRealtimeSnapshot()).toBeNull();

    time.tick(300_000);

    expect(adapter.reads).toHaveLength(1);
  });

  it("reports rejected cancellation at debug only without failure publication", async () => {
    using errors = stub(Logger.prototype, "error");
    using debug = stub(Logger.prototype, "debug");
    const stopping = poller.stop();

    adapter.reads[0].reject(new Error("cancelled read"));
    await stopping;

    expect(errors.calls).toHaveLength(0);
    expect(debug.calls.map((call) => call.args)).toEqual([[
      "Poll cancelled by restart/stop",
    ]]);
    expect(events).toEqual([]);
    expect(poller.tryGetRealtimeSnapshot()).toBeNull();
  });

  it("drains late success before replacing the adapter and starts only the new loop", async () => {
    const restarting = poller.restart(() => adapter.reconfigure());

    expect(adapter.reads[0].signal?.aborted).toBe(true);

    await Promise.resolve();

    expect(adapter.reconfigurations).toEqual([]);

    adapter.reads[0].resolve(sample());
    await restarting;
    await adapter.waitForRead(2);

    expect(adapter.reconfigurations).toEqual([1]);
    expect(poller.tryGetRealtimeSnapshot()).toBeNull();

    time.tick(300_000);

    expect(adapter.reads).toHaveLength(2);
  });

  it("serializes simultaneous restarts and drains each old loop", async () => {
    const first = poller.restart();
    const second = poller.restart();

    adapter.reads[0].resolve(sample());
    await first;
    // The second restart may have entered a read before its queued drain.
    adapter.reads.slice(1).forEach((read) => read.resolve(sample()));
    await second;
    await adapter.waitForRead(adapter.reads.length);

    expect(adapter.reads.filter((read) => !read.signal?.aborted)).toHaveLength(
      1,
    );
  });

  it("drains late failure before config rebuild and coalesces one save", async () => {
    emitter.emit("config_changed", { key: "test.host" });
    emitter.emit("config_changed", { key: "test.password" });
    await Promise.resolve(); // The documented config coalescing microtask.

    expect(adapter.reads[0].signal?.aborted).toBe(true);
    expect(adapter.reconfigurations).toEqual([]);

    adapter.reads[0].reject(new Error("late failure"));
    await adapter.waitForRead(2);

    expect(adapter.reconfigurations).toEqual([1]);
    expect(events).toEqual([]);
  });

  it("stop dominates config queued before its microtask", async () => {
    emitter.emit("config_changed", { key: "test.host" });
    const stopping = poller.stop();

    adapter.reads[0].resolve(sample());
    await stopping;
    await poller.restart();

    expect(adapter.reconfigurations).toEqual([]);
    expect(adapter.reads).toHaveLength(1);
  });

  it("stop drains a rejecting reconfigure and prevents a queued restart", async () => {
    const gate = Promise.withResolvers<void>();
    adapter.reconfigureGate = gate.promise;
    using errors = stub(Logger.prototype, "error");
    const restarting = poller.restart(() => adapter.reconfigure());

    adapter.reads[0].resolve(sample());
    await adapter.reconfigureEntered.promise;

    const queued = poller.restart(() => adapter.reconfigure());
    const beforeStop = [...events];

    const stopping = poller.stop();

    gate.reject(new Error("late reconfigure"));
    await Promise.all([restarting, queued, stopping]);

    expect(adapter.reconfigurations).toEqual([1]);
    expect(adapter.reads).toHaveLength(1);
    expect(errors.calls).toHaveLength(0);
    expect(events).toEqual(beforeStop);
  });

  it("stop drains rejecting startup readiness without reading or publishing", async () => {
    const stopping = poller.stop();

    adapter.reads[0].resolve(sample());
    await stopping;
    events = [];
    adapter = new MockEnergyPollerAdapter(sample());
    adapter.deferred = true;

    const gate = Promise.withResolvers<void>();
    adapter.readyGate = gate.promise;
    using errors = stub(Logger.prototype, "error");
    poller = create();

    await adapter.readyEntered.promise;

    const stopped = poller.stop();

    gate.reject(new Error("late readiness"));
    await stopped;

    expect(adapter.reads).toHaveLength(0);
    expect(events).toEqual([]);
    expect(errors.calls).toHaveLength(0);
  });

  it("logs current readiness failure and permits a later successful restart", async () => {
    const stopped = poller.stop();

    adapter.reads[0].resolve(sample());
    await stopped;
    adapter = new MockEnergyPollerAdapter(sample());
    adapter.readyGate = Promise.reject(new Error("current startup"));

    using errors = stub(Logger.prototype, "error");
    poller = create();

    await adapter.readyEntered.promise;

    await poller.restart();

    expect(errors.calls.length).toBeGreaterThan(0);

    adapter.readyGate = Promise.resolve();
    adapter.deferred = true;

    await poller.restart();
    await adapter.waitForRead(1);
  });

  [false, true].forEach((sharedReadiness) => {
    it(`restart cancels stale readiness diagnostics (shared=${sharedReadiness})`, async () => {
      const stopped = poller.stop();

      adapter.reads[0].resolve(sample());
      await stopped;
      events = [];
      adapter = new MockEnergyPollerAdapter(sample());
      adapter.deferred = true;

      const gate = Promise.withResolvers<void>();
      adapter.readyGate = gate.promise;
      using errors = stub(Logger.prototype, "error");
      poller = create();

      await adapter.readyEntered.promise;

      const next = poller.restart(() => {
        if (!sharedReadiness) adapter.readyGate = Promise.resolve();
        return Promise.resolve();
      });
      const failure = new Error("initialization failed");

      gate.reject(failure);
      await next;

      expect(errors.calls).toHaveLength(sharedReadiness ? 1 : 0);
      if (sharedReadiness) {
        expect(errors.calls[0].args).toEqual([
          "Energy poller restart failed:",
          failure,
        ]);
        adapter.readyGate = Promise.resolve();

        await poller.restart();
      }
      await adapter.waitForRead(1);

      expect(events).toEqual([]);
    });
  });

  it("restart cancels an active reconfiguration diagnosis without poisoning the queue", async () => {
    const gate = Promise.withResolvers<void>();
    adapter.reconfigureGate = gate.promise;
    using errors = stub(Logger.prototype, "error");
    const first = poller.restart(() => adapter.reconfigure());

    adapter.reads[0].resolve(sample());
    await adapter.reconfigureEntered.promise;

    const next = poller.restart();

    gate.reject(new Error("obsolete reconfiguration"));
    await Promise.all([first, next]);
    await adapter.waitForRead(2);

    expect(errors.calls).toHaveLength(0);
  });
});
