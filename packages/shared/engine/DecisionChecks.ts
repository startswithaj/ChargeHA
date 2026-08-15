/** All valid decision check names. */
export type CheckName =
  | "mode"
  | "vehicle_state"
  | "plugged_in"
  | "location"
  | "battery_at_limit"
  | "battery_priority"
  | "free_tariff"
  | "solar_tracking"
  | "blockout_schedule"
  | "charge_schedule"
  | "min_solar_generation"
  | "min_excess_solar"
  | "cooldown"
  | "amp_debounce"
  | "grace_period"
  | "vehicle_polling"
  | "solar_allocation";

/** A single check performed during decision evaluation. */
export interface DecisionCheck {
  check: CheckName;
  result: string;
}

/**
 * Static factory for all decision check objects.
 * Each method returns a complete { check, result } with the check name baked in,
 * keeping diagnostic formatting and check naming out of business logic.
 */
export class DecisionChecks {
  static mode(mode: string): DecisionCheck {
    return { check: "mode", result: mode };
  }

  static vehicleStateUnavailable(): DecisionCheck {
    return { check: "vehicle_state", result: "no state yet — not polled" };
  }

  static pluggedIn(isPluggedIn: boolean): DecisionCheck {
    const result = isPluggedIn ? "yes" : "no";
    return { check: "plugged_in", result };
  }

  static location(isHome: boolean | null): DecisionCheck {
    if (isHome === false) return { check: "location", result: "away" };
    if (isHome === true) return { check: "location", result: "home" };
    return { check: "location", result: "unknown (assuming home)" };
  }

  static batteryAtLimit(
    atLimit: boolean,
    nearLimitAndDone: boolean,
    batteryLevel: number,
    chargeLimit: number,
  ): DecisionCheck {
    if (atLimit) {
      return {
        check: "battery_at_limit",
        result: `yes (${batteryLevel}% >= ${chargeLimit}%)`,
      };
    }
    if (nearLimitAndDone) {
      return {
        check: "battery_at_limit",
        result:
          `near (${batteryLevel}% within 1% of ${chargeLimit}%, vehicle stopped)`,
      };
    }
    return {
      check: "battery_at_limit",
      result: `no (${batteryLevel}% < ${chargeLimit}%)`,
    };
  }

  static batteryPrioritySkip(enabled: boolean): DecisionCheck {
    const result = enabled ? "skip (no energy data)" : "skip (disabled)";
    return { check: "battery_priority", result };
  }

  static batteryPriority(
    batterySoc: number | null,
    limit: number,
    belowLimit: boolean,
  ): DecisionCheck {
    if (belowLimit) {
      return {
        check: "battery_priority",
        result: `hold (${batterySoc}% < ${limit}%)`,
      };
    }
    if (batterySoc !== null) {
      return {
        check: "battery_priority",
        result: `ok (${batterySoc}% >= ${limit}%)`,
      };
    }
    return { check: "battery_priority", result: "no battery data" };
  }

  static freeTariffSkip(enabled: boolean): DecisionCheck {
    const result = enabled ? "skip (rate unknown)" : "skip (disabled)";
    return { check: "free_tariff", result };
  }

  /** Rate is known — record whether it clears the "free" threshold. */
  static freeTariff(
    ratePerKwh: number,
    maxRatePerKwh: number,
    isFree: boolean,
  ): DecisionCheck {
    const comparison = isFree ? "<=" : ">";
    return {
      check: "free_tariff",
      result: `${
        isFree ? "free" : "not free"
      } (${ratePerKwh} ${comparison} ${maxRatePerKwh}/kWh)`,
    };
  }

  /** Grid is free but the home battery's SoC can't be read, so the battery
   *  priority limit can't be honoured — hold rather than guess. */
  static freeTariffBatteryUnknown(): DecisionCheck {
    return {
      check: "free_tariff",
      result: "hold (battery priority on, home battery SoC unknown)",
    };
  }

  static solarTrackingSkip(enabled: boolean): DecisionCheck {
    const result = enabled ? "skip (no energy data)" : "disabled";
    return { check: "solar_tracking", result };
  }

  static blockoutSchedule(
    activeBlockout: { startTime: string; endTime: string } | null,
  ): DecisionCheck {
    const result = activeBlockout
      ? `active: ${activeBlockout.startTime}-${activeBlockout.endTime}`
      : "none active";
    return { check: "blockout_schedule", result };
  }

  static chargeScheduleNone(): DecisionCheck {
    return { check: "charge_schedule", result: "none active" };
  }

  static chargeSchedule(
    schedule: {
      startTime: string;
      endTime: string;
      chargeAmps: number | null;
      chargeLimitPct: number | null;
    },
    batteryLevel: number,
    limitReached: boolean,
  ): DecisionCheck {
    const amps = schedule.chargeAmps ?? "max";
    const base = `active: ${schedule.startTime}-${schedule.endTime} @ ${amps}A`;
    const result = limitReached
      ? `${base} — limit reached (${batteryLevel}% >= ${schedule.chargeLimitPct}%)`
      : base;
    return { check: "charge_schedule", result };
  }

  static minSolarGeneration(
    solarKw: number,
    minKw: number,
  ): DecisionCheck {
    const result = solarKw >= minKw
      ? `ok (${solarKw.toFixed(2)} kW >= ${minKw} kW)`
      : `below (${solarKw.toFixed(2)} kW < ${minKw} kW)`;
    return { check: "min_solar_generation", result };
  }

  static minExcessSolar(
    excessKw: number,
    thresholdKw: number,
  ): DecisionCheck {
    const result = excessKw >= thresholdKw
      ? `ok (${excessKw.toFixed(2)} kW >= ${thresholdKw} kW)`
      : `below (${excessKw.toFixed(2)} kW < ${thresholdKw} kW)`;
    return { check: "min_excess_solar", result };
  }

  static solarAvailable(
    availableW: number,
    targetAmps: number,
    minAmps: number,
    maxAmps: number,
  ): DecisionCheck {
    return {
      check: "solar_tracking",
      result: `available ${
        Math.round(availableW)
      }W → ${targetAmps}A (clamped ${minAmps}-${maxAmps})`,
    };
  }

  static cooldown(remainingSec: number): DecisionCheck {
    return {
      check: "cooldown",
      result: `active (${remainingSec}s remaining)`,
    };
  }

  static ampDebounce(currentAmps: number, targetAmps: number): DecisionCheck {
    return {
      check: "amp_debounce",
      result: `held at ${currentAmps}A (target ${targetAmps}A, settling)`,
    };
  }

  static gracePeriod(
    expired: boolean,
    elapsedSec: number,
    graceSec: number,
  ): DecisionCheck {
    const result = expired
      ? `expired (${elapsedSec}s >= ${graceSec}s)`
      : `active (${elapsedSec}s < ${graceSec}s)`;
    return { check: "grace_period", result };
  }

  static pollingSuspended(suspended: boolean): DecisionCheck {
    return {
      check: "vehicle_polling",
      result: suspended ? "suspended" : "active",
    };
  }

  static solarAllocation(
    allocatedAmps: number,
    totalAmps: number,
    mode: "equal" | "waterfall",
    priority: number,
  ): DecisionCheck {
    return {
      check: "solar_allocation",
      result:
        `${allocatedAmps}A of ${totalAmps}A (${mode} mode, priority ${priority})`,
    };
  }
}
