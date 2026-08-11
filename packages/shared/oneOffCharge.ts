import {
  addDaysToDate,
  getLocalDateTime,
  minutesToTime,
  timeToMinutes,
} from "./localTime.ts";

/** Duration bounds for a one-off charge, in minutes. */
export const ONE_OFF_MIN_MINUTES = 30;
export const ONE_OFF_MAX_MINUTES = 8 * 60;
export const ONE_OFF_STEP_MINUTES = 30;

/** Default one-off start time (wall clock, user's timezone). */
export const ONE_OFF_DEFAULT_START = "23:30";
/** Default one-off duration in minutes. */
export const ONE_OFF_DEFAULT_MINUTES = 3 * 60;

/** Selectable durations: 30m to 8h in 30-minute steps. */
export const ONE_OFF_DURATION_OPTIONS: number[] = Array.from(
  {
    length: (ONE_OFF_MAX_MINUTES - ONE_OFF_MIN_MINUTES) /
        ONE_OFF_STEP_MINUTES + 1,
  },
  (_, i) => ONE_OFF_MIN_MINUTES + i * ONE_OFF_STEP_MINUTES,
);

/** The resolved calendar window a one-off charge will run in. */
export interface OneOffWindow {
  /** Calendar date the window starts on ("YYYY-MM-DD", user's timezone). */
  oneOffDate: string;
  /** Wall-clock end time ("HH:MM"). */
  endTime: string;
  /** Calendar date the window ends on. */
  endDate: string;
  /** True when the window runs past midnight into the next date. */
  wrapsMidnight: boolean;
  /** True when the start resolves to tomorrow because it has already passed. */
  isTomorrow: boolean;
}

/**
 * Resolve the next occurrence of a wall-clock start time.
 *
 * A one-off charge is always the *next* time that clock reading comes around:
 * still ahead today means tonight, already passed means tomorrow. Times are
 * resolved against the user's configured timezone, not the server's.
 */
export function resolveOneOffWindow(
  startTime: string,
  durationMinutes: number,
  now: Date,
  timezone: string,
): OneOffWindow {
  const local = getLocalDateTime(now, timezone);
  const startMinutes = timeToMinutes(startTime);
  const isTomorrow = startMinutes <= local.minutesSinceMidnight;
  const oneOffDate = isTomorrow ? addDaysToDate(local.date, 1) : local.date;

  const endAbsolute = startMinutes + durationMinutes;
  const wrapsMidnight = endAbsolute >= 1440;

  return {
    oneOffDate,
    endTime: minutesToTime(endAbsolute),
    endDate: wrapsMidnight
      ? addDaysToDate(oneOffDate, Math.floor(endAbsolute / 1440))
      : oneOffDate,
    wrapsMidnight,
    isTomorrow,
  };
}

/** Round-trip a stored window back to a duration in minutes. */
export function oneOffDurationMinutes(
  startTime: string,
  endTime: string,
): number {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return end > start ? end - start : 1440 - start + end;
}

/** Format a duration in minutes as "3h", "30m", or "1h 30m". */
export function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
