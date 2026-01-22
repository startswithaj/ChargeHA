import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { DecisionChecks } from "@chargeha/shared/engine";

describe("DecisionChecks", () => {
  describe("mode", () => {
    it("returns check with mode value", () => {
      expect(DecisionChecks.mode("auto")).toEqual({
        check: "mode",
        result: "auto",
      });
    });
  });

  describe("vehicleStateUnavailable", () => {
    it("returns vehicle_state check", () => {
      expect(DecisionChecks.vehicleStateUnavailable()).toEqual({
        check: "vehicle_state",
        result: "no state yet — not polled",
      });
    });
  });

  describe("pluggedIn", () => {
    it("returns 'yes' when plugged in", () => {
      expect(DecisionChecks.pluggedIn(true)).toEqual({
        check: "plugged_in",
        result: "yes",
      });
    });

    it("returns 'no' when not plugged in", () => {
      expect(DecisionChecks.pluggedIn(false)).toEqual({
        check: "plugged_in",
        result: "no",
      });
    });
  });

  describe("location", () => {
    it("returns 'away' when isHome is false", () => {
      expect(DecisionChecks.location(false)).toEqual({
        check: "location",
        result: "away",
      });
    });

    it("returns 'home' when isHome is true", () => {
      expect(DecisionChecks.location(true)).toEqual({
        check: "location",
        result: "home",
      });
    });

    it("returns 'unknown (assuming home)' when isHome is null", () => {
      expect(DecisionChecks.location(null)).toEqual({
        check: "location",
        result: "unknown (assuming home)",
      });
    });
  });

  describe("batteryAtLimit", () => {
    it("returns 'yes' when at limit", () => {
      expect(DecisionChecks.batteryAtLimit(true, false, 80, 80)).toEqual({
        check: "battery_at_limit",
        result: "yes (80% >= 80%)",
      });
    });

    it("returns 'near' when near limit and done", () => {
      expect(DecisionChecks.batteryAtLimit(false, true, 99, 100)).toEqual({
        check: "battery_at_limit",
        result: "near (99% within 1% of 100%, vehicle stopped)",
      });
    });

    it("returns 'no' when below limit", () => {
      expect(DecisionChecks.batteryAtLimit(false, false, 50, 80)).toEqual({
        check: "battery_at_limit",
        result: "no (50% < 80%)",
      });
    });
  });

  describe("batteryPrioritySkip", () => {
    it("returns 'skip (no energy data)' when enabled", () => {
      expect(DecisionChecks.batteryPrioritySkip(true)).toEqual({
        check: "battery_priority",
        result: "skip (no energy data)",
      });
    });

    it("returns 'skip (disabled)' when disabled", () => {
      expect(DecisionChecks.batteryPrioritySkip(false)).toEqual({
        check: "battery_priority",
        result: "skip (disabled)",
      });
    });
  });

  describe("batteryPriority", () => {
    it("returns 'hold' when below limit", () => {
      expect(DecisionChecks.batteryPriority(30, 50, true)).toEqual({
        check: "battery_priority",
        result: "hold (30% < 50%)",
      });
    });

    it("returns 'ok' when at or above limit", () => {
      expect(DecisionChecks.batteryPriority(60, 50, false)).toEqual({
        check: "battery_priority",
        result: "ok (60% >= 50%)",
      });
    });

    it("returns 'no battery data' when batterySoc is null", () => {
      expect(DecisionChecks.batteryPriority(null, 50, false)).toEqual({
        check: "battery_priority",
        result: "no battery data",
      });
    });
  });

  describe("solarTrackingSkip", () => {
    it("returns 'skip (no energy data)' when enabled", () => {
      expect(DecisionChecks.solarTrackingSkip(true)).toEqual({
        check: "solar_tracking",
        result: "skip (no energy data)",
      });
    });

    it("returns 'disabled' when disabled", () => {
      expect(DecisionChecks.solarTrackingSkip(false)).toEqual({
        check: "solar_tracking",
        result: "disabled",
      });
    });
  });

  describe("blockoutSchedule", () => {
    it("returns 'none active' when no blockout", () => {
      expect(DecisionChecks.blockoutSchedule(null)).toEqual({
        check: "blockout_schedule",
        result: "none active",
      });
    });

    it("returns active schedule time range", () => {
      expect(
        DecisionChecks.blockoutSchedule({
          startTime: "22:00",
          endTime: "06:00",
        }),
      ).toEqual({
        check: "blockout_schedule",
        result: "active: 22:00-06:00",
      });
    });
  });

  describe("chargeScheduleNone", () => {
    it("returns 'none active'", () => {
      expect(DecisionChecks.chargeScheduleNone()).toEqual({
        check: "charge_schedule",
        result: "none active",
      });
    });
  });

  describe("chargeSchedule", () => {
    it("returns active schedule with amps", () => {
      const schedule = {
        startTime: "01:00",
        endTime: "06:00",
        chargeAmps: 16,
        chargeLimitPct: null,
      };
      expect(DecisionChecks.chargeSchedule(schedule, 50, false)).toEqual({
        check: "charge_schedule",
        result: "active: 01:00-06:00 @ 16A",
      });
    });

    it("returns 'max' when chargeAmps is null", () => {
      const schedule = {
        startTime: "01:00",
        endTime: "06:00",
        chargeAmps: null,
        chargeLimitPct: null,
      };
      expect(DecisionChecks.chargeSchedule(schedule, 50, false)).toEqual({
        check: "charge_schedule",
        result: "active: 01:00-06:00 @ maxA",
      });
    });

    it("includes limit reached info", () => {
      const schedule = {
        startTime: "01:00",
        endTime: "06:00",
        chargeAmps: 16,
        chargeLimitPct: 80,
      };
      expect(DecisionChecks.chargeSchedule(schedule, 85, true)).toEqual({
        check: "charge_schedule",
        result: "active: 01:00-06:00 @ 16A — limit reached (85% >= 80%)",
      });
    });
  });

  describe("minSolarGeneration", () => {
    it("returns 'ok' when above minimum", () => {
      expect(DecisionChecks.minSolarGeneration(2.5, 1.0)).toEqual({
        check: "min_solar_generation",
        result: "ok (2.50 kW >= 1 kW)",
      });
    });

    it("returns 'below' when under minimum", () => {
      expect(DecisionChecks.minSolarGeneration(0.3, 1.0)).toEqual({
        check: "min_solar_generation",
        result: "below (0.30 kW < 1 kW)",
      });
    });

    it("returns 'ok' when exactly at minimum", () => {
      expect(DecisionChecks.minSolarGeneration(1.0, 1.0)).toEqual({
        check: "min_solar_generation",
        result: "ok (1.00 kW >= 1 kW)",
      });
    });
  });

  describe("solarAvailable", () => {
    it("formats available solar watts and target amps", () => {
      expect(DecisionChecks.solarAvailable(2400, 10, 5, 16)).toEqual({
        check: "solar_tracking",
        result: "available 2400W → 10A (clamped 5-16)",
      });
    });

    it("rounds watts to nearest integer", () => {
      expect(DecisionChecks.solarAvailable(2399.7, 10, 5, 16)).toEqual({
        check: "solar_tracking",
        result: "available 2400W → 10A (clamped 5-16)",
      });
    });
  });

  describe("cooldown", () => {
    it("formats remaining seconds", () => {
      expect(DecisionChecks.cooldown(120)).toEqual({
        check: "cooldown",
        result: "active (120s remaining)",
      });
    });
  });

  describe("ampDebounce", () => {
    it("formats held amp change", () => {
      expect(DecisionChecks.ampDebounce(10, 11)).toEqual({
        check: "amp_debounce",
        result: "held at 10A (target 11A, settling)",
      });
    });
  });

  describe("gracePeriod", () => {
    it("returns 'expired' when grace period is over", () => {
      expect(DecisionChecks.gracePeriod(true, 300, 300)).toEqual({
        check: "grace_period",
        result: "expired (300s >= 300s)",
      });
    });

    it("returns 'active' when grace period is ongoing", () => {
      expect(DecisionChecks.gracePeriod(false, 60, 300)).toEqual({
        check: "grace_period",
        result: "active (60s < 300s)",
      });
    });
  });
});
