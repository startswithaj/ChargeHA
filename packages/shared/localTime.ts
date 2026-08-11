import type { DayOfWeek } from "./types.ts";

/** Schedules and tariffs are wall-clock times in the user's configured
 *  timezone, not UTC. These helpers convert an instant into that wall clock
 *  and do calendar-date arithmetic on the "YYYY-MM-DD" strings we store. */

const DAY_ABBRS: DayOfWeek[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const WEEKDAY_TO_DAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock date and time in a specific timezone. */
export interface LocalDateTime {
  /** 0 = Sunday. */
  day: number;
  hours: number;
  minutes: number;
  /** Local calendar date as "YYYY-MM-DD". */
  date: string;
  /** Minutes since local midnight. */
  minutesSinceMidnight: number;
}

const pad = (n: number): string => String(n).padStart(2, "0");

function parseInTimezone(now: Date, timezone: string): LocalDateTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // hour12: false yields "24" for midnight in some ICU versions
  const hours = Number(part("hour")) % 24;
  const minutes = Number(part("minute") || 0);
  return {
    day: WEEKDAY_TO_DAY[part("weekday")] ?? now.getDay(),
    hours,
    minutes,
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minutesSinceMidnight: hours * 60 + minutes,
  };
}

/** Resolve the wall-clock date/time in the given timezone. Falls back to the
 *  host's local time when no timezone is configured. */
export function getLocalDateTime(now: Date, timezone: string): LocalDateTime {
  if (timezone) return parseInTimezone(now, timezone);
  return {
    day: now.getDay(),
    hours: now.getHours(),
    minutes: now.getMinutes(),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${
      pad(now.getDate())
    }`,
    minutesSinceMidnight: now.getHours() * 60 + now.getMinutes(),
  };
}

/** Shift a "YYYY-MM-DD" date string by whole days. */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  // UTC arithmetic — these are calendar dates, so no DST shift applies
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${
    pad(shifted.getUTCDate())
  }`;
}

/** Day-of-week abbreviation for a "YYYY-MM-DD" date string. */
export function dayOfWeekForDate(date: string): DayOfWeek {
  const [y, m, d] = date.split("-").map(Number);
  return DAY_ABBRS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Parse "HH:MM" into minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Format minutes since midnight as "HH:MM", wrapping past 24h. */
export function minutesToTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}
