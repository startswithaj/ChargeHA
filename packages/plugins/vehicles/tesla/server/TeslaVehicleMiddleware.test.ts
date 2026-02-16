import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import type { VehicleAdapter } from "@chargeha/shared";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type { VehicleRequestContext } from "../../../types.ts";
import { TeslaVehicleMiddleware } from "./TeslaVehicleMiddleware.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import { MockTeslaAdapter } from "./test-helpers/MockTeslaAdapter.ts";

describe("TeslaVehicleMiddleware", () => {
  const testLogger = new Logger("TeslaMiddleware", "error");

  const ctx = (
    overrides: Partial<VehicleRequestContext> = {},
  ): VehicleRequestContext => ({
    origin: "test",
    traceId: "test",
    hasSolar: false,
    hasSchedule: false,
    hasBlockout: false,
    ...overrides,
  });

  const cc = (origin: string) => ({ origin, traceId: "test" });

  let adapter: MockTeslaAdapter;
  let middleware: TeslaVehicleMiddleware;
  let time: FakeTime;

  beforeEach(() => {
    time = new FakeTime();
    adapter = new MockTeslaAdapter();
    middleware = new TeslaVehicleMiddleware(
      adapter as unknown as VehicleAdapter,
      testLogger,
    );
  });

  afterEach(() => {
    time.restore();
  });

  describe("getCachedState", () => {
    it("returns null when no state has been fetched", () => {
      expect(middleware.getCachedState()).toBeNull();
    });

    it("returns state after a fetch", async () => {
      await middleware.requestState(ctx());
      const state = middleware.getCachedState();
      expect(state).not.toBeNull();
      expect(state?.batteryLevel).toBe(60);
    });
  });

  describe("seedState", () => {
    it("seeds state when cache is empty", () => {
      const seeded = buildVehicleChargeState({ batteryLevel: 50 });
      middleware.seedState(seeded);
      expect(middleware.getCachedState()?.batteryLevel).toBe(50);
    });

    it("does not overwrite existing state", async () => {
      await middleware.requestState(ctx());
      middleware.seedState(buildVehicleChargeState({ batteryLevel: 99 }));
      expect(middleware.getCachedState()?.batteryLevel).toBe(60);
    });
  });

  describe("requestState", () => {
    it("fetches on first call (no cache)", async () => {
      await middleware.requestState(ctx());
      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.getChargeStateCalls).toBe(1);
    });

    it("returns cache when fresh", async () => {
      await middleware.requestState(ctx());
      adapter.getChargeStateCalls = 0;
      adapter.isVehicleOnlineCalls = 0;

      const state = await middleware.requestState(ctx());
      expect(state?.batteryLevel).toBe(60);
      expect(adapter.isVehicleOnlineCalls).toBe(0);
      expect(adapter.getChargeStateCalls).toBe(0);
    });

    it("fetches again when cache is stale (idle)", async () => {
      await middleware.requestState(ctx());
      adapter.getChargeStateCalls = 0;
      adapter.isVehicleOnlineCalls = 0;

      time.tick(21 * 60 * 1000); // 21 min > 20 min idle staleness

      await middleware.requestState(ctx());
      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.getChargeStateCalls).toBe(1);
    });

    it("fetches sooner when solar is active", async () => {
      await middleware.requestState(ctx({ hasSolar: true }));
      adapter.getChargeStateCalls = 0;
      adapter.isVehicleOnlineCalls = 0;

      time.tick(11 * 60 * 1000); // 11 min > 10 min can-charge staleness

      await middleware.requestState(ctx({ hasSolar: true }));
      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.getChargeStateCalls).toBe(1);
    });

    it("returns cache (marked offline) when vehicle is offline", async () => {
      // Seed some state so cache exists
      middleware.seedState(
        buildVehicleChargeState({ isOnline: true, batteryLevel: 42 }),
      );
      adapter.isOnline = false;

      // Force stale by advancing past no-state interval
      time.tick(4 * 60 * 1000);

      const state = await middleware.requestState(ctx());
      expect(state?.batteryLevel).toBe(42);
      expect(state?.isOnline).toBe(false);
      expect(adapter.getChargeStateCalls).toBe(0);
    });

    ([
      ["schedule", { hasSchedule: true }],
      ["solar", { hasSolar: true }],
    ] as const).forEach(([label, overrides]) => {
      it(
        `wakes vehicle when ${label} is active and car is asleep`,
        async () => {
          adapter.isOnline = false;

          await middleware.requestState(ctx(overrides));

          expect(adapter.wakeVehicleCalls).toBe(1);
          expect(adapter.getChargeStateCalls).toBe(1);
        },
      );
    });

    it("does not wake during blockout even with schedule", async () => {
      adapter.isOnline = false;

      await middleware.requestState(
        ctx({ hasSchedule: true, hasBlockout: true }),
      );

      expect(adapter.wakeVehicleCalls).toBe(0);
    });

    it("does not wake when no schedule and no solar", async () => {
      adapter.isOnline = false;

      await middleware.requestState(ctx());

      expect(adapter.wakeVehicleCalls).toBe(0);
    });

    it("rate-limits wakes to once per hour", async () => {
      adapter.isOnline = false;

      // First wake succeeds
      await middleware.requestState(ctx({ hasSchedule: true }));
      expect(adapter.wakeVehicleCalls).toBe(1);

      // Simulate car going back to sleep
      adapter.isOnline = false;
      adapter.state = buildVehicleChargeState({ isOnline: false });
      time.tick(30 * 60 * 1000); // 30 min — within cooldown

      await middleware.requestState(ctx({ hasSchedule: true }));
      expect(adapter.wakeVehicleCalls).toBe(1); // No second wake

      // After cooldown expires
      time.tick(31 * 60 * 1000); // Total 61 min

      await middleware.requestState(ctx({ hasSchedule: true }));
      expect(adapter.wakeVehicleCalls).toBe(2);
    });

    it("returns null when wake fails", async () => {
      adapter.isOnline = false;
      adapter.wakeResult = false;

      const state = await middleware.requestState(ctx({ hasSchedule: true }));
      expect(state).toBeNull();
    });

    it("propagates adapter errors so VehicleManager can report them", async () => {
      // Middleware must NOT swallow adapter failures — otherwise transient
      // Tesla API outages silently return stale cache and never surface on
      // the dashboard as lastError.
      middleware.seedState(buildVehicleChargeState({ batteryLevel: 55 }));
      adapter.isOnline = true;

      time.tick(25 * 60 * 1000); // Force stale so we actually fetch
      adapter.getChargeState = () => Promise.reject(new Error("408 timeout"));

      await expect(middleware.requestState(ctx())).rejects.toThrow(
        "408 timeout",
      );
    });

    it("propagates online-check failures", async () => {
      middleware.seedState(buildVehicleChargeState());
      adapter.isVehicleOnline = () =>
        Promise.reject(new Error("503 Service Unavailable"));

      await expect(middleware.requestState(ctx())).rejects.toThrow(
        "503 Service Unavailable",
      );
    });

    it("refreshes immediately when car self-wakes (offline → online transition)", async () => {
      // Seed with car asleep + unplugged. While we have a fresh cache,
      // the car wakes itself (e.g. user plugs in). Without transition
      // detection the cache would stay stale until the freshness window
      // expires (up to 20 min idle), causing missed schedules.
      adapter.isOnline = false;
      await middleware.requestState(ctx());
      adapter.getChargeStateCalls = 0;
      adapter.isVehicleOnlineCalls = 0;

      // Wait past the online-check debounce (60s) so the next probe fires.
      time.tick(61_000);

      // Car self-wakes
      adapter.isOnline = true;
      adapter.state = buildVehicleChargeState({
        batteryLevel: 70,
        isPluggedIn: true,
      });

      const state = await middleware.requestState(ctx());
      // Probe ran, transition detected, fresh fetch happened
      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.getChargeStateCalls).toBe(1);
      expect(state?.isPluggedIn).toBe(true);
      expect(state?.batteryLevel).toBe(70);
    });

    it("does not wake an unplugged vehicle even with schedule active", async () => {
      // Cached state says unplugged. shouldWake() should skip the wake —
      // Tesla self-wakes on plug-in, so the free probe catches that path.
      middleware.seedState(
        buildVehicleChargeState({
          isPluggedIn: false,
          batteryLevel: 50,
          chargeLimit: 80,
        }),
      );
      adapter.isOnline = false;

      await middleware.requestState(ctx({ hasSchedule: true }));

      expect(adapter.wakeVehicleCalls).toBe(0);
    });

    it("debounces /vehicles probe within the 60s window", async () => {
      // First call probes; second call within 60s reuses lastKnownOnline
      // and skips the adapter call.
      await middleware.requestState(ctx());
      expect(adapter.isVehicleOnlineCalls).toBe(1);

      time.tick(30_000); // 30s — within 60s debounce
      adapter.isVehicleOnlineCalls = 0;
      await middleware.requestState(ctx());
      expect(adapter.isVehicleOnlineCalls).toBe(0);

      time.tick(31_000); // Total 61s — past debounce
      await middleware.requestState(ctx());
      expect(adapter.isVehicleOnlineCalls).toBe(1);
    });

    it("forceRefresh bypasses the online-check debounce", async () => {
      await middleware.requestState(ctx());
      adapter.isVehicleOnlineCalls = 0;

      time.tick(10_000); // Within 60s debounce
      await middleware.requestState(ctx({ forceRefresh: true }));
      expect(adapter.isVehicleOnlineCalls).toBe(1);
    });

    it("returns cached state for the normal asleep-but-can't-wake path (not an error)", async () => {
      middleware.seedState(buildVehicleChargeState({ batteryLevel: 55 }));
      adapter.isOnline = false;
      // No solar, no schedule → shouldWake returns false.

      const state = await middleware.requestState(ctx());
      expect(state?.batteryLevel).toBe(55);
      expect(middleware.online).toBe(false);
    });

    it("refetches every 5 min while online + unplugged to catch plug-in", async () => {
      // First fetch: car online, cached unplugged. The 5-min staleness rule
      // exists because Tesla sleeps ~5-6 min after plug-in if not charging,
      // so we need a vehicle_data fetch inside that window or the plug-in
      // event is lost.
      adapter.state = buildVehicleChargeState({
        isOnline: true,
        isPluggedIn: false,
      });
      await middleware.requestState(ctx());
      adapter.getChargeStateCalls = 0;

      // 4 min later — within 5 min staleness window, no refetch.
      time.tick(4 * 60 * 1000);
      await middleware.requestState(ctx());
      expect(adapter.getChargeStateCalls).toBe(0);

      // Past the 5 min window — must refetch and catch the plug-in.
      time.tick(61 * 1000);
      adapter.state = buildVehicleChargeState({
        isOnline: true,
        isPluggedIn: true,
      });
      const state = await middleware.requestState(ctx());
      expect(adapter.getChargeStateCalls).toBe(1);
      expect(state?.isPluggedIn).toBe(true);
    });
  });

  describe("commands", () => {
    const commandCases: Array<
      [string, () => Promise<unknown>, () => number]
    > = [
      [
        "startCharging",
        () => middleware.startCharging(cc("test:start")),
        () => adapter.startChargingCalls,
      ],
      [
        "stopCharging",
        () => middleware.stopCharging(cc("test:stop")),
        () => adapter.stopChargingCalls,
      ],
      [
        "setChargeAmps",
        () => middleware.setChargeAmps(16, cc("test:amps")),
        () => adapter.setChargeAmpsCalls,
      ],
    ];
    commandCases.forEach(([label, run, getCalls]) => {
      it(`delegates ${label} to adapter when online`, async () => {
        await run();
        expect(getCalls()).toBe(1);
      });
    });

    it("performs a free online check before every command", async () => {
      await middleware.startCharging(cc("test:start"));
      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.wakeVehicleCalls).toBe(0);
    });

    it("wakes vehicle before command when offline", async () => {
      adapter.isOnline = false;
      adapter.wakeResult = true;

      await middleware.startCharging(cc("user:start"));

      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.wakeVehicleCalls).toBe(1);
      expect(adapter.startChargingCalls).toBe(1);
    });

    it("skips wake when online check reveals vehicle is awake", async () => {
      adapter.isOnline = true;

      await middleware.setChargeAmps(16, cc("user:amps"));

      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.wakeVehicleCalls).toBe(0);
      expect(adapter.setChargeAmpsCalls).toBe(1);
    });

    it("throws when wake fails, without invoking the command", async () => {
      adapter.isOnline = false;
      adapter.wakeResult = false;

      await expect(middleware.stopCharging(cc("user:stop"))).rejects.toThrow(
        "wakeVehicle rejected",
      );

      expect(adapter.stopChargingCalls).toBe(0);
    });
  });

  describe("online", () => {
    it("returns false initially", () => {
      expect(middleware.online).toBe(false);
    });

    it("returns true after successful fetch", async () => {
      await middleware.requestState(ctx());
      expect(middleware.online).toBe(true);
    });

    it("returns false after vehicle goes offline", async () => {
      await middleware.requestState(ctx());
      expect(middleware.online).toBe(true);

      adapter.isOnline = false;
      time.tick(21 * 60 * 1000); // Past idle staleness to trigger a fresh check
      await middleware.requestState(ctx());
      expect(middleware.online).toBe(false);
    });
  });
});
