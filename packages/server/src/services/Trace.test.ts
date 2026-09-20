import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Trace } from "@chargeha/shared/engine";

describe("Trace", () => {
  const schedule = {
    startTime: "01:00",
    endTime: "06:00",
    chargeAmps: 16,
    chargeLimitPct: 80,
  };

  it("mode", () => {
    expect(Trace.mode("auto")).toEqual({ check: "mode", result: "auto" });
  });

  it("vehicleStateUnavailable", () => {
    expect(Trace.vehicleStateUnavailable()).toEqual({
      check: "vehicle_state",
      result: "no state yet — not polled",
    });
  });

  it("plugged in", () => {
    expect(Trace.pluggedIn()).toEqual({ check: "plugged_in", result: "yes" });
    expect(Trace.unplugged()).toEqual({ check: "plugged_in", result: "no" });
  });

  it("location", () => {
    expect(Trace.home()).toEqual({ check: "location", result: "home" });
    expect(Trace.away()).toEqual({ check: "location", result: "away" });
    expect(Trace.locationUnknown()).toEqual({
      check: "location",
      result: "unknown (assuming home)",
    });
  });

  it("battery limit", () => {
    expect(Trace.batteryAtLimit(80, 80)).toEqual({
      check: "battery_at_limit",
      result: "yes (80% >= 80%)",
    });
    expect(Trace.batteryNearLimit(99, 100)).toEqual({
      check: "battery_at_limit",
      result: "near (99% within 1% of 100%, vehicle stopped)",
    });
    expect(Trace.batteryBelowLimit(50, 80)).toEqual({
      check: "battery_at_limit",
      result: "no (50% < 80%)",
    });
  });

  it("battery priority", () => {
    expect(Trace.batteryPriorityDisabled()).toEqual({
      check: "battery_priority",
      result: "skip (disabled)",
    });
    expect(Trace.batteryPriorityNoEnergy()).toEqual({
      check: "battery_priority",
      result: "skip (no energy data)",
    });
    expect(Trace.batteryPriorityHold(30, 50)).toEqual({
      check: "battery_priority",
      result: "hold (30% < 50%)",
    });
    expect(Trace.batteryPriorityOk(60, 50)).toEqual({
      check: "battery_priority",
      result: "ok (60% >= 50%)",
    });
    expect(Trace.batteryPriorityNoData()).toEqual({
      check: "battery_priority",
      result: "no battery data",
    });
  });

  it("solar tracking skip", () => {
    expect(Trace.solarTrackingDisabled()).toEqual({
      check: "solar_tracking",
      result: "disabled",
    });
    expect(Trace.solarTrackingNoEnergy()).toEqual({
      check: "solar_tracking",
      result: "skip (no energy data)",
    });
  });

  it("blockout", () => {
    expect(Trace.blockoutNone()).toEqual({
      check: "blockout_schedule",
      result: "none active",
    });
    expect(Trace.blockoutActive({ startTime: "22:00", endTime: "06:00" }))
      .toEqual({
        check: "blockout_schedule",
        result: "active: 22:00-06:00",
      });
  });

  it("charge schedule", () => {
    expect(Trace.scheduleNone()).toEqual({
      check: "charge_schedule",
      result: "none active",
    });
    expect(Trace.scheduleActive(schedule)).toEqual({
      check: "charge_schedule",
      result: "active: 01:00-06:00 @ 16A",
    });
    expect(Trace.scheduleActive({ ...schedule, chargeAmps: null })).toEqual({
      check: "charge_schedule",
      result: "active: 01:00-06:00 @ maxA",
    });
    expect(Trace.scheduleLimitReached(schedule, 85)).toEqual({
      check: "charge_schedule",
      result: "active: 01:00-06:00 @ 16A — limit reached (85% >= 80%)",
    });
  });

  it("min solar generation", () => {
    expect(Trace.minSolarOk(2.5, 1.0)).toEqual({
      check: "min_solar_generation",
      result: "ok (2.50 kW >= 1 kW)",
    });
    expect(Trace.minSolarBelow(0.3, 1.0)).toEqual({
      check: "min_solar_generation",
      result: "below (0.30 kW < 1 kW)",
    });
  });

  it("min excess solar", () => {
    expect(Trace.minExcessOk(2.5, 1.0)).toEqual({
      check: "min_excess_solar",
      result: "ok (2.50 kW >= 1 kW)",
    });
    expect(Trace.minExcessBelow(0.3, 1.0)).toEqual({
      check: "min_excess_solar",
      result: "below (0.30 kW < 1 kW)",
    });
  });

  it("solarAvailable rounds watts", () => {
    expect(Trace.solarAvailable(2399.7, 10, 5, 16)).toEqual({
      check: "solar_tracking",
      result: "available 2400W → 10A (clamped 5-16)",
    });
  });

  it("cooldown", () => {
    expect(Trace.cooldown(120)).toEqual({
      check: "cooldown",
      result: "active (120s remaining)",
    });
  });

  it("ampDebounce", () => {
    expect(Trace.ampDebounce(10, 11)).toEqual({
      check: "amp_debounce",
      result: "held at 10A (target 11A, settling)",
    });
  });

  it("grace period", () => {
    expect(Trace.graceExpired(300, 300)).toEqual({
      check: "grace_period",
      result: "expired (300s >= 300s)",
    });
    expect(Trace.graceActive(60, 300)).toEqual({
      check: "grace_period",
      result: "active (60s < 300s)",
    });
  });

  it("solarAllocation", () => {
    expect(Trace.solarAllocation(8, 16, "equal", 1)).toEqual({
      check: "solar_allocation",
      result: "8A of 16A (equal mode, priority 1)",
    });
  });
});
