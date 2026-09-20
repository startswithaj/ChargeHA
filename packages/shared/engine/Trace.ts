export type TraceName =
  | "mode"
  | "vehicle_state"
  | "plugged_in"
  | "location"
  | "battery_at_limit"
  | "battery_priority"
  | "solar_tracking"
  | "blockout_schedule"
  | "charge_schedule"
  | "min_solar_generation"
  | "min_excess_solar"
  | "cooldown"
  | "amp_debounce"
  | "grace_period"
  | "solar_allocation";

// One diagnostic line recorded while a step runs. Purely informational —
// nothing reads it for control flow.
export interface StepTrace {
  check: TraceName;
  result: string;
}

// Pure formatters. One method per outcome so the caller, not the formatter,
// decides which outcome occurred.
export class Trace {
  static mode(mode: string): StepTrace {
    return { check: "mode", result: mode };
  }

  static vehicleStateUnavailable(): StepTrace {
    return { check: "vehicle_state", result: "no state yet — not polled" };
  }

  static pluggedIn(): StepTrace {
    return { check: "plugged_in", result: "yes" };
  }

  static unplugged(): StepTrace {
    return { check: "plugged_in", result: "no" };
  }

  static home(): StepTrace {
    return { check: "location", result: "home" };
  }

  static away(): StepTrace {
    return { check: "location", result: "away" };
  }

  static locationUnknown(): StepTrace {
    return { check: "location", result: "unknown (assuming home)" };
  }

  static batteryAtLimit(batteryLevel: number, chargeLimit: number): StepTrace {
    return {
      check: "battery_at_limit",
      result: `yes (${batteryLevel}% >= ${chargeLimit}%)`,
    };
  }

  static batteryNearLimit(
    batteryLevel: number,
    chargeLimit: number,
  ): StepTrace {
    return {
      check: "battery_at_limit",
      result:
        `near (${batteryLevel}% within 1% of ${chargeLimit}%, vehicle stopped)`,
    };
  }

  static batteryBelowLimit(
    batteryLevel: number,
    chargeLimit: number,
  ): StepTrace {
    return {
      check: "battery_at_limit",
      result: `no (${batteryLevel}% < ${chargeLimit}%)`,
    };
  }

  static batteryPriorityDisabled(): StepTrace {
    return { check: "battery_priority", result: "skip (disabled)" };
  }

  static batteryPriorityNoEnergy(): StepTrace {
    return { check: "battery_priority", result: "skip (no energy data)" };
  }

  static batteryPriorityHold(batterySoc: number, limit: number): StepTrace {
    return {
      check: "battery_priority",
      result: `hold (${batterySoc}% < ${limit}%)`,
    };
  }

  static batteryPriorityOk(batterySoc: number, limit: number): StepTrace {
    return {
      check: "battery_priority",
      result: `ok (${batterySoc}% >= ${limit}%)`,
    };
  }

  static batteryPriorityNoData(): StepTrace {
    return { check: "battery_priority", result: "no battery data" };
  }

  static solarTrackingDisabled(): StepTrace {
    return { check: "solar_tracking", result: "disabled" };
  }

  static solarTrackingNoEnergy(): StepTrace {
    return { check: "solar_tracking", result: "skip (no energy data)" };
  }

  static blockoutActive(
    schedule: { startTime: string; endTime: string },
  ): StepTrace {
    return {
      check: "blockout_schedule",
      result: `active: ${schedule.startTime}-${schedule.endTime}`,
    };
  }

  static blockoutNone(): StepTrace {
    return { check: "blockout_schedule", result: "none active" };
  }

  static scheduleNone(): StepTrace {
    return { check: "charge_schedule", result: "none active" };
  }

  static scheduleActive(
    schedule: { startTime: string; endTime: string; chargeAmps: number | null },
  ): StepTrace {
    return { check: "charge_schedule", result: scheduleSummary(schedule) };
  }

  static scheduleLimitReached(
    schedule: {
      startTime: string;
      endTime: string;
      chargeAmps: number | null;
      chargeLimitPct: number | null;
    },
    batteryLevel: number,
  ): StepTrace {
    return {
      check: "charge_schedule",
      result: `${
        scheduleSummary(schedule)
      } — limit reached (${batteryLevel}% >= ${schedule.chargeLimitPct}%)`,
    };
  }

  static minSolarOk(solarKw: number, minKw: number): StepTrace {
    return {
      check: "min_solar_generation",
      result: `ok (${solarKw.toFixed(2)} kW >= ${minKw} kW)`,
    };
  }

  static minSolarBelow(solarKw: number, minKw: number): StepTrace {
    return {
      check: "min_solar_generation",
      result: `below (${solarKw.toFixed(2)} kW < ${minKw} kW)`,
    };
  }

  static minExcessOk(excessKw: number, thresholdKw: number): StepTrace {
    return {
      check: "min_excess_solar",
      result: `ok (${excessKw.toFixed(2)} kW >= ${thresholdKw} kW)`,
    };
  }

  static minExcessBelow(excessKw: number, thresholdKw: number): StepTrace {
    return {
      check: "min_excess_solar",
      result: `below (${excessKw.toFixed(2)} kW < ${thresholdKw} kW)`,
    };
  }

  static solarAvailable(
    availableW: number,
    targetAmps: number,
    minAmps: number,
    maxAmps: number,
  ): StepTrace {
    return {
      check: "solar_tracking",
      result: `available ${
        Math.round(availableW)
      }W → ${targetAmps}A (clamped ${minAmps}-${maxAmps})`,
    };
  }

  static cooldown(remainingSec: number): StepTrace {
    return {
      check: "cooldown",
      result: `active (${remainingSec}s remaining)`,
    };
  }

  static ampDebounce(currentAmps: number, targetAmps: number): StepTrace {
    return {
      check: "amp_debounce",
      result: `held at ${currentAmps}A (target ${targetAmps}A, settling)`,
    };
  }

  static graceActive(elapsedSec: number, graceSec: number): StepTrace {
    return {
      check: "grace_period",
      result: `active (${elapsedSec}s < ${graceSec}s)`,
    };
  }

  static graceExpired(elapsedSec: number, graceSec: number): StepTrace {
    return {
      check: "grace_period",
      result: `expired (${elapsedSec}s >= ${graceSec}s)`,
    };
  }

  static solarAllocation(
    allocatedAmps: number,
    totalAmps: number,
    mode: "equal" | "waterfall",
    priority: number,
  ): StepTrace {
    return {
      check: "solar_allocation",
      result:
        `${allocatedAmps}A of ${totalAmps}A (${mode} mode, priority ${priority})`,
    };
  }
}

function scheduleSummary(
  schedule: { startTime: string; endTime: string; chargeAmps: number | null },
): string {
  const amps = schedule.chargeAmps ?? "max";
  return `active: ${schedule.startTime}-${schedule.endTime} @ ${amps}A`;
}
