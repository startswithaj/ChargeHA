import type { MutationHandlers } from "../types.ts";
import type { DemoSchedule } from "../../demoState.ts";
import { updateDemoState } from "../../demoState.ts";
import { toSchedule } from "../schedule.ts";

type ScheduleMutations = Pick<
  MutationHandlers,
  "schedule.create" | "schedule.update" | "schedule.delete"
>;

export const scheduleMutations: ScheduleMutations = {
  "schedule.create": (input) => {
    const isCharge = input.scheduleType === "charge";
    const created: DemoSchedule = {
      id: crypto.randomUUID(),
      vehicleId: isCharge ? (input.vehicleId ?? null) : null,
      scheduleType: input.scheduleType,
      startTime: input.startTime,
      endTime: input.endTime,
      days: input.days,
      chargeAmps: isCharge ? (input.chargeAmps ?? null) : null,
      chargeLimitPct: isCharge ? (input.chargeLimitPct ?? null) : null,
      enabled: true,
    };
    updateDemoState((m) => ({ ...m, schedules: [...m.schedules, created] }));
    return { schedule: toSchedule(created) };
  },

  "schedule.update": (input) => {
    // undefined = field omitted (keep current); a provided value (incl. null) wins.
    const merge = (s: DemoSchedule): DemoSchedule => ({
      ...s,
      vehicleId: input.vehicleId !== undefined ? input.vehicleId : s.vehicleId,
      scheduleType: input.scheduleType ?? s.scheduleType,
      startTime: input.startTime ?? s.startTime,
      endTime: input.endTime ?? s.endTime,
      days: input.days ?? s.days,
      chargeAmps: input.chargeAmps !== undefined
        ? input.chargeAmps
        : s.chargeAmps,
      chargeLimitPct: input.chargeLimitPct !== undefined
        ? input.chargeLimitPct
        : s.chargeLimitPct,
      enabled: input.enabled ?? s.enabled,
    });
    const next = updateDemoState((m) => ({
      ...m,
      schedules: m.schedules.map((s) => (s.id === input.id ? merge(s) : s)),
    }));
    const updated = next.schedules.find((s) => s.id === input.id);
    if (!updated) throw new Error(`Demo: schedule "${input.id}" not found`);
    return { schedule: toSchedule(updated) };
  },

  "schedule.delete": (input) => {
    updateDemoState((m) => ({
      ...m,
      schedules: m.schedules.filter((s) => s.id !== input.id),
    }));
    return { success: true };
  },
};
