import type { DayOfWeek } from "@chargeha/shared";
import type { QueryHandler } from "./types.ts";
import type { DemoSchedule } from "../demoState.ts";
import { minuteOfDay } from "../demoDates.ts";
import { demoNow } from "../demoClock.ts";

const DAY_ABBRS: DayOfWeek[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

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
      vehicleId: r.vehicleId,
      chargerId: r.chargerId,
      scheduleType: "charge" as const,
      chargeAmps: r.chargeAmps ?? 0,
      chargeLimitPct: r.chargeLimitPct,
    };
  }
  return {
    ...base,
    vehicleId: null,
    chargerId: null,
    scheduleType: "blockout" as const,
  };
};

const minutesOf = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// Handles a window that wraps past midnight.
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
    s.schedules.filter((r) => isActiveNow(r, demoNow())).map(toSchedule),
};
