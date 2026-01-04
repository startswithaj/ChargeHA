import type { DayOfWeek } from "@chargeha/shared";
import type { TariffPeriodRow } from "../db/types.ts";

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];
const WEEKEND = ["sat", "sun"];

/**
 * Determine the specificity of a tariff period's day selection.
 * Lower = more specific = higher priority.
 *
 * Specificity ranking:
 *   1. Specific individual days (not matching weekdays/weekend/every-day patterns)
 *   2. Weekdays or weekend
 *   3. Every day (all 7 days)
 */
function daySpecificity(days: string[]): number {
  const sorted = [...days].sort();
  const key = sorted.join(",");

  // Every day — least specific
  if (
    days.length === 7 &&
    key === [...ALL_DAYS].sort().join(",")
  ) {
    return 3;
  }

  // Weekdays or weekend — medium specificity
  if (
    days.length === 5 &&
    key === [...WEEKDAYS].sort().join(",")
  ) {
    return 2;
  }
  if (
    days.length === 2 &&
    key === [...WEEKEND].sort().join(",")
  ) {
    return 2;
  }

  // Specific days — most specific
  return 1;
}

/** Parse "HH:MM" to minutes since midnight. */
export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Find the applicable tariff period for a given time-of-day and day-of-week.
 *
 * This operates on explicit time components so callers can handle timezone
 * conversion before calling. Returns the matching period, or null if no
 * period matches (meaning the default rate applies).
 */
export function getApplicablePeriodForTime(
  minutesSinceMidnight: number,
  dayAbbr: DayOfWeek,
  tariffPeriods: TariffPeriodRow[],
): TariffPeriodRow | null {
  const matches = tariffPeriods
    .filter((p) => p.enabled)
    .filter((p) => p.days.includes(dayAbbr))
    .filter((p) => {
      const start = parseTimeToMinutes(p.startTime);
      const end = parseTimeToMinutes(p.endTime);
      if (start > end) {
        // Overnight period (e.g. 22:00-07:00): matches if current >= start OR current < end
        return minutesSinceMidnight >= start || minutesSinceMidnight < end;
      }
      return minutesSinceMidnight >= start && minutesSinceMidnight < end;
    });

  if (matches.length === 0) return null;

  matches.sort((a, b) => daySpecificity(a.days) - daySpecificity(b.days));
  return matches[0];
}
