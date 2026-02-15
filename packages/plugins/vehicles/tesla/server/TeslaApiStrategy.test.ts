import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";
import type { VehicleRequestContext } from "../../../types.ts";
import { TeslaApiStrategy } from "./TeslaApiStrategy.ts";

describe("TeslaApiStrategy", () => {
  const strategy = new TeslaApiStrategy();

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

  describe("staleness", () => {
    it("returns 3 min when no cached state", () => {
      expect(strategy.staleness(ctx(), null)).toBe(3 * 60 * 1000);
    });

    ([
      ["solar", { hasSolar: true }],
      ["schedule", { hasSchedule: true }],
    ] as const).forEach(([label, overrides]) => {
      it(`returns 10 min when ${label} is active`, () => {
        const state = buildVehicleChargeState();
        expect(strategy.staleness(ctx(overrides), state)).toBe(10 * 60 * 1000);
      });
    });

    it("returns 20 min when idle (no solar, no schedule)", () => {
      const state = buildVehicleChargeState();
      expect(strategy.staleness(ctx(), state)).toBe(20 * 60 * 1000);
    });

    it("returns 5 min when online and cached unplugged", () => {
      // Tight window so we catch a plug-in before Tesla sleeps (~5-6 min
      // after plug-in if not actively charging).
      const state = buildVehicleChargeState({
        isOnline: true,
        isPluggedIn: false,
      });
      expect(strategy.staleness(ctx(), state)).toBe(5 * 60 * 1000);
    });

    it("uses can-charge staleness when online and plugged in", () => {
      const state = buildVehicleChargeState({
        isOnline: true,
        isPluggedIn: true,
      });
      expect(strategy.staleness(ctx({ hasSolar: true }), state))
        .toBe(10 * 60 * 1000);
    });

    it("uses cant-charge staleness when offline (regardless of plug)", () => {
      const state = buildVehicleChargeState({
        isOnline: false,
        isPluggedIn: false,
      });
      expect(strategy.staleness(ctx(), state)).toBe(20 * 60 * 1000);
    });
  });

  describe("isCacheFresh", () => {
    it("returns false when no cached state", () => {
      expect(strategy.isCacheFresh(ctx(), null, 0)).toBe(false);
    });

    it("returns true when fetched recently with solar", () => {
      const state = buildVehicleChargeState();
      const now = Date.now();
      expect(strategy.isCacheFresh(ctx({ hasSolar: true }), state, now))
        .toBe(true);
    });

    it("returns false when cache exceeds can-charge staleness", () => {
      using time = new FakeTime();
      const state = buildVehicleChargeState();
      const fetchedAt = Date.now();
      time.tick(11 * 60 * 1000); // 11 min > 10 min
      expect(strategy.isCacheFresh(ctx({ hasSolar: true }), state, fetchedAt))
        .toBe(false);
    });

    it("uses cant-charge staleness when idle", () => {
      using time = new FakeTime();
      const state = buildVehicleChargeState();
      const fetchedAt = Date.now();
      time.tick(15 * 60 * 1000); // 15 min < 20 min
      expect(strategy.isCacheFresh(ctx(), state, fetchedAt)).toBe(true);
    });

    it("returns false when cache exceeds cant-charge staleness", () => {
      using time = new FakeTime();
      const state = buildVehicleChargeState();
      const fetchedAt = Date.now();
      time.tick(21 * 60 * 1000); // 21 min > 20 min
      expect(strategy.isCacheFresh(ctx(), state, fetchedAt)).toBe(false);
    });
  });

  describe("shouldWake", () => {
    it("returns null during blockout", () => {
      expect(
        strategy.shouldWake(
          ctx({ hasBlockout: true, hasSchedule: true }),
          null,
          0,
        ),
      ).toBeNull();
    });

    it("returns null when no schedule and no solar", () => {
      expect(strategy.shouldWake(ctx(), null, 0)).toBeNull();
    });

    ([
      ["schedule", { hasSchedule: true }],
      ["solar", { hasSolar: true }],
    ] as const).forEach(([label, overrides]) => {
      it(`returns ${label} when cooldown expired`, () => {
        using time = new FakeTime();
        const wokeAt = Date.now();
        time.tick(61 * 60 * 1000);
        expect(strategy.shouldWake(ctx(overrides), null, wokeAt)).toBe(label);
      });

      it(`returns null for ${label} within cooldown`, () => {
        using time = new FakeTime();
        const wokeAt = Date.now();
        time.tick(30 * 60 * 1000);
        expect(strategy.shouldWake(ctx(overrides), null, wokeAt)).toBeNull();
      });
    });

    it("returns 'schedule' when never woken before and schedule active", () => {
      expect(strategy.shouldWake(ctx({ hasSchedule: true }), null, 0))
        .toBe("schedule");
    });

    it("returns null when cached state shows car is not plugged in", () => {
      // Tesla wakes itself on plug-in, so the free /vehicles probe will
      // catch it — no point spending $0.02 waking an unplugged car.
      const state = buildVehicleChargeState({
        batteryLevel: 60,
        chargeLimit: 80,
        isPluggedIn: false,
      });
      expect(strategy.shouldWake(ctx({ hasSchedule: true }), state, 0))
        .toBeNull();
      expect(strategy.shouldWake(ctx({ hasSolar: true }), state, 0))
        .toBeNull();
    });

    it("returns 'schedule' when plugged in and below charge limit", () => {
      const state = buildVehicleChargeState({
        batteryLevel: 60,
        chargeLimit: 80,
        isPluggedIn: true,
      });
      expect(strategy.shouldWake(ctx({ hasSchedule: true }), state, 0))
        .toBe("schedule");
    });

    it("returns null when cached battery already at charge limit", () => {
      const state = buildVehicleChargeState({
        batteryLevel: 100,
        chargeLimit: 100,
      });
      expect(strategy.shouldWake(ctx({ hasSchedule: true }), state, 0))
        .toBeNull();
    });

    it("returns 'schedule' when cached battery is below charge limit", () => {
      const state = buildVehicleChargeState({
        batteryLevel: 60,
        chargeLimit: 80,
      });
      expect(strategy.shouldWake(ctx({ hasSchedule: true }), state, 0))
        .toBe("schedule");
    });

    it("returns null when scheduleChargeLimitPct already reached", () => {
      const state = buildVehicleChargeState({
        batteryLevel: 81,
        chargeLimit: 100,
      });
      expect(
        strategy.shouldWake(
          ctx({ hasSchedule: true, scheduleChargeLimitPct: 80 }),
          state,
          0,
        ),
      ).toBeNull();
    });

    it("uses min of vehicle limit and schedule limit", () => {
      const state = buildVehicleChargeState({
        batteryLevel: 70,
        chargeLimit: 100,
      });
      // Schedule limit 80 — below it, should still wake
      expect(
        strategy.shouldWake(
          ctx({ hasSchedule: true, scheduleChargeLimitPct: 80 }),
          state,
          0,
        ),
      ).toBe("schedule");
    });

    it("ignores scheduleChargeLimitPct when null (no schedule limit set)", () => {
      const state = buildVehicleChargeState({
        batteryLevel: 70,
        chargeLimit: 80,
      });
      expect(
        strategy.shouldWake(
          ctx({ hasSchedule: true, scheduleChargeLimitPct: null }),
          state,
          0,
        ),
      ).toBe("schedule");
    });
  });
});
