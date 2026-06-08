import type { DayOfWeek } from "@chargeha/shared";
import type { QueryHandler } from "./types.ts";
import type { DemoSchedule } from "../demoState.ts";
import { minuteOfDay } from "../demoDates.ts";

const DAY_ABBRS: DayOfWeek[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

/** Map a stored schedule to the server's discriminated charge/blockout shape. */
export const toSchedule = (r: DemoSchedule) => {
  const base = {
    id: r.id,
    startTime: r.startTime,
    endTime: r.endTime,
    days: r.days,
    enabled: r.enabled,
  };
  if (r.scheduleType === "charge") {
    return {
      ...base,
      vehicleId: r.vehicleId ?? "",
      scheduleType: "charge" as const,
      chargeAmps: r.chargeAmps ?? 0,
      chargeLimitPct: r.chargeLimitPct ?? 0,
    };
  }
  return { ...base, vehicleId: null, scheduleType: "blockout" as const };
};

const minutesOf = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** True if the schedule is enabled and its window contains `now` (handles wrap). */
export const isActiveNow = (r: DemoSchedule, now: Date): boolean => {
  if (!r.enabled || !r.days.includes(DAY_ABBRS[now.getDay()])) return false;
  const cur = minuteOfDay(now);
  const start = minutesOf(r.startTime);
  const end = minutesOf(r.endTime);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
};

export const scheduleHandlers: Record<string, QueryHandler> = {
  "schedule.list": (_i, s) => ({ schedules: s.schedules.map(toSchedule) }),
  "schedule.active": (_i, s) =>
    s.schedules.filter((r) => isActiveNow(r, new Date())).map(toSchedule),
};
