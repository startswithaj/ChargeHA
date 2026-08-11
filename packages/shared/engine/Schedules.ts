import type { DayOfWeek } from "../types.ts";
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

const WEEKDAY_TO_DAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseTimezone(
  now: Date,
  timezone: string,
): { day: number; hours: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  return {
    day: WEEKDAY_TO_DAY[
      parts.find((p) => p.type === "weekday")?.value ?? ""
    ] ?? now.getDay(),
    hours: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    minutes: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
  };
}

// Parse an "HH:MM" schedule time into minutes since midnight.
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isScheduleActiveNow(
  schedule: EngineSchedule,
  now: Date,
  timezone: string,
): boolean {
  // Get the current time in the configured timezone (schedules are defined
  // in the user's timezone, not the server's local time)
  const { day, hours, minutes } = timezone
    ? parseTimezone(now, timezone)
    : { day: now.getDay(), hours: now.getHours(), minutes: now.getMinutes() };

  const dayKey = DAY_MAP[String(day)];
  if (!schedule.days.includes(dayKey)) return false;

  const currentMinutes = hours * 60 + minutes;
  const startMinutes = toMinutes(schedule.startTime);
  const endMinutes = toMinutes(schedule.endTime);

  if (startMinutes <= endMinutes) {
    // Normal range (e.g. 09:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g. 22:00 - 06:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

// Global schedules (no target) apply everywhere; targeted ones match the
// charging point directly or via its linked vehicle.
export function scheduleTargets(
  s: EngineSchedule,
  target: { id: string; vehicleId: string | null },
): boolean {
  if (s.chargerId !== null) return s.chargerId === target.id;
  if (s.vehicleId !== null) return s.vehicleId === target.vehicleId;
  return true;
}

// A charger-keyed schedule outranks a vehicle-keyed one, which outranks an
// untargeted one. Rank decides which schedule supplies the window and amps.
function targetRank(s: EngineSchedule): number {
  if (s.chargerId !== null) return 0;
  if (s.vehicleId !== null) return 1;
  return 2;
}

// Window length in minutes, wrapping past midnight the same way
// isScheduleActiveNow does.
function windowMinutes(s: EngineSchedule): number {
  const start = toMinutes(s.startTime);
  const end = toMinutes(s.endTime);
  if (end > start) return end - start;
  return end + 1440 - start;
}

// Total order over overlapping charge schedules: rank, then earliest start,
// then longest window, then id — never depends on database row order.
function compareSchedules(a: EngineSchedule, b: EngineSchedule): number {
  const byRank = targetRank(a) - targetRank(b);
  if (byRank !== 0) return byRank;
  const byStart = toMinutes(a.startTime) - toMinutes(b.startTime);
  if (byStart !== 0) return byStart;
  const byLength = windowMinutes(b) - windowMinutes(a);
  if (byLength !== 0) return byLength;
  return a.id < b.id ? -1 : 1;
}

export interface ActiveChargeSchedule {
  // Window and amps from the highest-ranked overlapping schedule, with
  // chargeLimitPct replaced by the strictest limit of the whole set.
  effective: EngineSchedule;
  contributors: EngineSchedule[];
  merged: boolean;
}

// Blockouts are always global; charge schedules match by chargerId,
// vehicleId, or untargeted. Overlapping schedules (e.g. a charger-keyed one
// and a vehicle-keyed one) merge: highest-ranked supplies window/amps, strictest chargeLimitPct still applies.
export function selectActiveChargeSchedule(
  schedules: EngineSchedule[],
  target: { id: string; vehicleId: string | null },
  now: Date,
  timezone: string,
): ActiveChargeSchedule | null {
  const contributors = schedules
    .filter((s) =>
      s.scheduleType === "charge" && s.enabled &&
      scheduleTargets(s, target) && isScheduleActiveNow(s, now, timezone)
    )
    .toSorted(compareSchedules);

  const primary = contributors[0];
  if (!primary) return null;

  const limits = contributors
    .map((s) => s.chargeLimitPct)
    .filter((pct): pct is number => pct !== null);
  const chargeLimitPct = limits.length > 0 ? Math.min(...limits) : null;

  return {
    effective: { ...primary, chargeLimitPct },
    contributors,
    merged: contributors.length > 1,
  };
}
