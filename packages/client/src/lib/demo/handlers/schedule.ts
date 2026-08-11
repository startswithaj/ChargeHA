import type { QueryHandler } from "./types.ts";
import type { DemoSchedule } from "../demoState.ts";
import { demoNow } from "../demoClock.ts";
import { isScheduleActiveNow } from "@chargeha/shared/engine";

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
      oneOffDate: r.oneOffDate ?? null,
    };
  }
  return { ...base, vehicleId: null, scheduleType: "blockout" as const };
};

/** True if the schedule is enabled and its window contains `now`.
 *  Delegates to the real engine predicate with an empty timezone, so the demo
 *  matches against browser-local time the way the rest of the demo clock does. */
export const isActiveNow = (r: DemoSchedule, now: Date): boolean =>
  r.enabled && isScheduleActiveNow(
    {
      id: r.id,
      vehicleId: r.vehicleId,
      scheduleType: r.scheduleType === "charge" ? "charge" : "blockout",
      startTime: r.startTime,
      endTime: r.endTime,
      days: r.days,
      chargeAmps: r.chargeAmps,
      chargeLimitPct: r.chargeLimitPct,
      oneOffDate: r.oneOffDate ?? null,
      enabled: r.enabled,
    },
    now,
    "",
  );

export const scheduleHandlers: Record<string, QueryHandler> = {
  "schedule.list": (_i, s) => ({ schedules: s.schedules.map(toSchedule) }),
  "schedule.active": (_i, s) =>
    s.schedules.filter((r) => isActiveNow(r, demoNow())).map(toSchedule),
};
