import type { DayOfWeek } from "../types.ts";
import {
  addDaysToDate,
  getLocalDateTime,
  timeToMinutes,
} from "../localTime.ts";
import type { EngineSchedule } from "./types.ts";

const DAY_MAP: Record<string, DayOfWeek> = {
  "0": "sun",
  "1": "mon",
  "2": "tue",
  "3": "wed",
  "4": "thu",
  "5": "fri",
  "6": "sat",
};

/** Check whether a schedule is active at the given time. */
export function isScheduleActiveNow(
  schedule: EngineSchedule,
  now: Date,
  timezone: string,
): boolean {
  // Get the current time in the configured timezone (schedules are defined
  // in the user's timezone, not the server's local time)
  const local = getLocalDateTime(now, timezone);
  const currentMinutes = local.minutesSinceMidnight;
  const startMinutes = timeToMinutes(schedule.startTime);
  const endMinutes = timeToMinutes(schedule.endTime);

  // One-off charges are anchored to a calendar date, so they match on date
  // rather than day-of-week: a window that wraps past midnight runs into the
  // next date, where the day-of-week no longer matches `days`.
  if (schedule.oneOffDate) {
    if (startMinutes <= endMinutes) {
      return local.date === schedule.oneOffDate &&
        currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    if (local.date === schedule.oneOffDate) {
      return currentMinutes >= startMinutes;
    }
    return local.date === addDaysToDate(schedule.oneOffDate, 1) &&
      currentMinutes < endMinutes;
  }

  // Check day of week
  const dayKey = DAY_MAP[String(local.day)];
  if (!schedule.days.includes(dayKey)) return false;

  if (startMinutes <= endMinutes) {
    // Normal range (e.g. 09:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g. 22:00 - 06:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/** True once a one-off charge's window has fully elapsed. Recurring schedules
 *  never expire, so they always return false. */
export function isOneOffExpired(
  schedule: EngineSchedule,
  now: Date,
  timezone: string,
): boolean {
  if (!schedule.oneOffDate) return false;

  const local = getLocalDateTime(now, timezone);
  const startMinutes = timeToMinutes(schedule.startTime);
  const endMinutes = timeToMinutes(schedule.endTime);
  const endDate = startMinutes > endMinutes
    ? addDaysToDate(schedule.oneOffDate, 1)
    : schedule.oneOffDate;

  if (local.date > endDate) return true;
  return local.date === endDate &&
    local.minutesSinceMidnight >= endMinutes;
}
