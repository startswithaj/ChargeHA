import { addDaysToDate, dayOfWeekForDate, timeToMinutes } from "./localTime.ts";
import { getApplicablePeriodForTime } from "./tariffs.ts";
import type { TariffPeriodLike } from "./tariffs.ts";

/** One tariff period's share of an estimated charging session. */
export interface CostEstimateSegment {
  label: string;
  ratePerKwh: number;
  minutes: number;
  kwh: number;
  cost: number;
}

export interface ChargeCostEstimate {
  /** Total energy delivered if the session runs the full window. */
  kwh: number;
  /** Total cost in the configured currency's major unit (e.g. dollars). */
  cost: number;
  powerKw: number;
  /** Per-tariff-period breakdown, largest cost first. */
  segments: CostEstimateSegment[];
}

export interface ChargeCostEstimateInput {
  /** Charge current in amps. */
  amps: number;
  /** Supply voltage. */
  volts: number;
  /** Number of active phases (1 or 3). */
  phases: number;
  /** Window length in minutes. */
  durationMinutes: number;
  /** Local calendar date the window starts on ("YYYY-MM-DD"). */
  startDate: string;
  /** Local wall-clock start time ("HH:MM"). */
  startTime: string;
  tariffPeriods: TariffPeriodLike[];
  /** Rate applied to any minute no tariff period covers. */
  defaultRatePerKwh: number;
}

const MINUTES_PER_DAY = 1440;

/** The vehicle-reported electrical readings needed to resolve charge power. */
export interface ChargerReadings {
  chargerVoltage: number;
  chargerPhases: number;
  isCharging: boolean;
}

/** Resolve charger voltage: trust the vehicle if >= 100V, otherwise fall back
 *  to the inverter grid reading, then the user's configured value. */
export function resolveChargeVoltage(
  state: ChargerReadings,
  gridVoltage: number,
  measuredGridVoltageV?: number | null,
): number {
  if (state.chargerVoltage >= 100) return state.chargerVoltage;
  return measuredGridVoltageV ?? gridVoltage;
}

/** Resolve charger phases: a live single-phase reading while charging overrides
 *  the threePhaseCharger flag (e.g. a three-phase install charging from a
 *  regular wall socket). Vehicles only report phases while charging, so the
 *  flag stands until a real reading arrives. */
export function resolveChargePhases(
  state: ChargerReadings,
  threePhaseCharger: boolean,
): number {
  if (state.isCharging && state.chargerPhases === 1) return 1;
  return threePhaseCharger ? 3 : state.chargerPhases;
}

/** Charging power in kW for a given current, voltage and phase count. */
export function chargePowerKw(
  amps: number,
  volts: number,
  phases: number,
): number {
  return (amps * volts * phases) / 1000;
}

/**
 * Estimate the cost of a charging session against the configured tariffs.
 *
 * Walks the window a minute at a time (capped at 8h, so ≤480 iterations),
 * resolving the applicable tariff for each minute and advancing the
 * day-of-week when the window crosses midnight. Minute granularity means
 * tariff boundaries land exactly where the recorder would put them.
 *
 * This is an upper bound: it assumes full grid import for the whole window,
 * a constant charge rate, and that the vehicle does not reach its charge
 * limit early.
 */
export function estimateChargeCost(
  input: ChargeCostEstimateInput,
): ChargeCostEstimate {
  const {
    amps,
    volts,
    phases,
    durationMinutes,
    startDate,
    startTime,
    tariffPeriods,
    defaultRatePerKwh,
  } = input;

  const powerKw = chargePowerKw(amps, volts, phases);
  const kwhPerMinute = powerKw / 60;
  const startMinutes = timeToMinutes(startTime);

  const rateForOffset = (offset: number) => {
    const absolute = startMinutes + offset;
    const dayOffset = Math.floor(absolute / MINUTES_PER_DAY);
    const date = dayOffset === 0
      ? startDate
      : addDaysToDate(startDate, dayOffset);
    const period = getApplicablePeriodForTime(
      absolute % MINUTES_PER_DAY,
      dayOfWeekForDate(date),
      tariffPeriods,
    );
    return {
      label: period?.label ?? "Default",
      ratePerKwh: period?.ratePerKwh ?? defaultRatePerKwh,
    };
  };

  // Accumulate per (label, rate) so a split period — e.g. two "Shoulder" blocks
  // either side of peak — reports as one line.
  const byKey = Array.from({ length: durationMinutes }, (_, i) => i)
    .map(rateForOffset)
    .reduce((acc, { label, ratePerKwh }) => {
      const key = `${label}|${ratePerKwh}`;
      const existing = acc.get(key);
      acc.set(key, {
        label,
        ratePerKwh,
        minutes: (existing?.minutes ?? 0) + 1,
        kwh: (existing?.kwh ?? 0) + kwhPerMinute,
        cost: (existing?.cost ?? 0) + kwhPerMinute * ratePerKwh,
      });
      return acc;
    }, new Map<string, CostEstimateSegment>());

  const segments = [...byKey.values()].sort((a, b) => b.cost - a.cost);

  return {
    kwh: kwhPerMinute * durationMinutes,
    cost: segments.reduce((sum, s) => sum + s.cost, 0),
    powerKw,
    segments,
  };
}
