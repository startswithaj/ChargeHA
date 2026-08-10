import type { ChargeSchedule, DayOfWeek } from "@chargeha/shared";

/** A charging point as this page sees it. `resolvedVehicleId` is the server's
 *  live answer from ChargingPointManager.resolveVehicle — a fact about right
 *  now, not a permanent link. */
export interface ConflictPoint {
  id: string;
  name: string;
  resolvedVehicleId: string | null;
  resolvedVehicleName: string | null;
}

export interface OverlapWindow {
  startTime: string;
  endTime: string;
}

export interface ScheduleConflict {
  pointId: string;
  pointName: string;
  vehicleName: string;
  windows: OverlapWindow[];
  days: DayOfWeek[];
  chargerAmps: number;
  chargerLimitPct: number | null;
  vehicleLimitPct: number | null;
}

const MINUTES_PER_DAY = 1440;

const DAY_ORDER: DayOfWeek[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

type Range = readonly [number, number];

const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

const pad = (n: number): string => String(n).padStart(2, "0");

const toTime = (minutes: number): string => {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/** The engine matches a schedule's `days` against the current instant, not
 *  against the day the window started (see isScheduleActiveNow). A wrapping
 *  window is therefore two ranges inside the same day, never a carry into the
 *  next one. A zero-length window can never be active, so it yields nothing. */
function ranges(window: { startTime: string; endTime: string }): Range[] {
  const start = toMinutes(window.startTime);
  const end = toMinutes(window.endTime);
  if (start < end) return [[start, end]];
  if (start === end) return [];
  return [[start, MINUTES_PER_DAY], [0, end]];
}

/** Half-open ranges, so a window ending at 06:00 and one starting at 06:00
 *  share no minute — the same boundary isScheduleActiveNow uses. */
function intersectRanges(a: Range[], b: Range[]): Range[] {
  return a.flatMap(([aStart, aEnd]) =>
    b.flatMap(([bStart, bEnd]): Range[] => {
      const start = Math.max(aStart, bStart);
      const end = Math.min(aEnd, bEnd);
      return start < end ? [[start, end]] : [];
    })
  );
}

/** Two wrapping windows intersect into a piece ending at midnight and a piece
 *  starting at midnight. They are one continuous window to the user, so join
 *  them back up before naming it. */
function joinAcrossMidnight(parts: Range[]): Range[] {
  const first = parts[0];
  const last = parts[parts.length - 1];
  const wraps = parts.length > 1 && first[0] === 0 &&
    last[1] === MINUTES_PER_DAY;
  if (!wraps) return parts;
  return [...parts.slice(1, -1), [last[0], first[1] + MINUTES_PER_DAY]];
}

/** The clock ranges two windows share, midnight crossings included. Empty when
 *  they never coincide. */
export function overlapWindows(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
): OverlapWindow[] {
  const parts = intersectRanges(ranges(a), ranges(b))
    .toSorted((x, y) => x[0] - y[0]);
  return joinAcrossMidnight(parts).map(([start, end]) => ({
    startTime: toTime(start),
    endTime: toTime(end),
  }));
}

/** Days both schedules run on. A weekday-only and a weekend-only pair share
 *  none, so they never overlap however much their clock times do. */
export function sharedDays(a: DayOfWeek[], b: DayOfWeek[]): DayOfWeek[] {
  return DAY_ORDER.filter((d) => a.includes(d) && b.includes(d));
}

export function formatDays(days: DayOfWeek[]): string {
  if (days.length === 7) return "every day";
  return days.map((d) => DAY_LABELS[d]).join(", ");
}

export function formatWindows(windows: OverlapWindow[]): string {
  return windows.map((w) => `${w.startTime}–${w.endTime}`).join(" and ");
}

/** A charger-keyed and a vehicle-keyed schedule can both drive one charging
 *  point: it matches the first directly and the second through the car
 *  currently plugged into it (see scheduleTargets in engine/Schedules.ts).
 *  Only the minutes they share are ambiguous — selectActiveChargeSchedule
 *  filters by time before anything merges. */
export function findScheduleConflicts(
  points: ConflictPoint[],
  chargeSchedules: ChargeSchedule[],
): ScheduleConflict[] {
  const enabled = chargeSchedules.filter((s) => s.enabled);
  return points.flatMap((point) =>
    enabled
      .filter((s) => s.chargerId === point.id)
      .flatMap((charger) =>
        enabled
          .filter((s) =>
            s.vehicleId !== null && s.vehicleId === point.resolvedVehicleId
          )
          .flatMap((vehicle): ScheduleConflict[] => {
            const days = sharedDays(charger.days, vehicle.days);
            const windows = days.length === 0
              ? []
              : overlapWindows(charger, vehicle);
            if (windows.length === 0) return [];
            return [{
              pointId: point.id,
              pointName: point.name,
              vehicleName: point.resolvedVehicleName ??
                "the plugged-in vehicle",
              windows,
              days,
              chargerAmps: charger.chargeAmps,
              chargerLimitPct: charger.chargeLimitPct,
              vehicleLimitPct: vehicle.chargeLimitPct,
            }];
          })
      )
  );
}
