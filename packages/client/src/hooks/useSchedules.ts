import { useMemo } from "react";
import type {
  BlockoutSchedule,
  ChargeSchedule,
  DayOfWeek,
  Schedule,
  ScheduleFormData,
} from "@chargeha/shared";
import { trpc } from "../trpc.ts";

/**
 * Check whether two time ranges on the same day overlap.
 * Handles overnight ranges (e.g. 23:00–06:00).
 */
export function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const aS = toMin(aStart);
  const aE = toMin(aEnd);
  const bS = toMin(bStart);
  const bE = toMin(bEnd);

  // Normalize overnight ranges by expanding to segments
  const aRanges: [number, number][] = aE > aS
    ? [[aS, aE]]
    : [[aS, 1440], [0, aE]];
  const bRanges: [number, number][] = bE > bS
    ? [[bS, bE]]
    : [[bS, 1440], [0, bE]];

  return aRanges.some(([a0, a1]) =>
    bRanges.some(([b0, b1]) => a0 < b1 && b0 < a1)
  );
}

export function daysOverlap(a: DayOfWeek[], b: DayOfWeek[]): boolean {
  return a.some((d) => b.includes(d));
}

/**
 * Validate that a schedule doesn't overlap with existing same-vehicle charge
 * schedules. Returns error message or null.
 */
export function validateScheduleOverlap(
  data: ScheduleFormData,
  schedules: Schedule[],
  excludeId?: string,
): string | null {
  if (data.scheduleType !== "charge") return null;

  const siblings = schedules.filter(
    (s) =>
      s.id !== excludeId &&
      s.scheduleType === "charge" &&
      s.vehicleId === data.vehicleId,
  );

  const overlapping = siblings.find((existing) =>
    daysOverlap(data.days, existing.days) &&
    timeRangesOverlap(
      data.startTime,
      data.endTime,
      existing.startTime,
      existing.endTime,
    )
  );
  return overlapping
    ? "This schedule overlaps with an existing charge schedule for the same vehicle."
    : null;
}

function useCreateScheduleMutation() {
  const utils = trpc.useUtils();
  return trpc.schedule.create.useMutation({
    onSuccess: ({ schedule }) => {
      utils.schedule.list.setData(
        undefined,
        (old) => old ? { schedules: [...old.schedules, schedule] } : old,
      );
    },
  });
}

function useUpdateScheduleMutation() {
  const utils = trpc.useUtils();
  return trpc.schedule.update.useMutation({
    onSuccess: ({ schedule }) => {
      utils.schedule.list.setData(undefined, (old) => {
        if (!old) return old;
        return {
          schedules: old.schedules.map((s) =>
            s.id === schedule.id ? schedule : s
          ),
        };
      });
    },
  });
}

function useToggleScheduleMutation() {
  const utils = trpc.useUtils();
  return trpc.schedule.update.useMutation({
    onMutate: async ({ id, enabled }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await utils.schedule.list.cancel();
      const previousData = utils.schedule.list.getData();
      utils.schedule.list.setData(undefined, (old) => {
        if (!old) return old;
        return {
          schedules: old.schedules.map((s) =>
            s.id === id ? { ...s, enabled: enabled ?? s.enabled } : s
          ),
        };
      });
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      // Revert to previous state on failure
      if (context?.previousData) {
        utils.schedule.list.setData(undefined, context.previousData);
      }
    },
  });
}

function useDeleteScheduleMutation() {
  const utils = trpc.useUtils();
  return trpc.schedule.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.schedule.list.cancel();
      const previousData = utils.schedule.list.getData();
      // Optimistic removal
      utils.schedule.list.setData(
        undefined,
        (old) =>
          old ? { schedules: old.schedules.filter((s) => s.id !== id) } : old,
      );
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      // Revert on failure
      if (context?.previousData) {
        utils.schedule.list.setData(undefined, context.previousData);
      }
    },
    onSettled: () => {
      utils.schedule.list.invalidate();
    },
  });
}

/**
 * Schedule management backed by tRPC with TanStack Query.
 * Client-side overlap validation is kept for immediate UX feedback.
 */
export function useSchedules() {
  const { data: scheduleData, isLoading: loading } = trpc.schedule.list
    .useQuery();

  const schedules = scheduleData?.schedules ?? [];
  const chargeSchedules = schedules.filter(
    (s): s is ChargeSchedule => s.scheduleType === "charge",
  );
  const blockoutSchedules = schedules.filter(
    (s): s is BlockoutSchedule => s.scheduleType === "blockout",
  );

  const createMutation = useCreateScheduleMutation();
  const updateMutation = useUpdateScheduleMutation();
  const toggleMutation = useToggleScheduleMutation();
  const deleteMutation = useDeleteScheduleMutation();

  // --- Stable callbacks matching the original API ---

  const addSchedule = useMemo(
    () => async (data: ScheduleFormData): Promise<string | null> => {
      const err = validateScheduleOverlap(data, schedules);
      if (err) return err;

      try {
        await createMutation.mutateAsync({
          ...data,
          days: data.days as [DayOfWeek, ...DayOfWeek[]],
        });
        return null;
      } catch (e) {
        const msg = e instanceof Error
          ? e.message
          : "Failed to create schedule";
        console.error("[useSchedules] Create failed:", msg);
        return msg;
      }
    },
    [schedules, createMutation.mutateAsync],
  );

  const updateSchedule = useMemo(
    () =>
    async (
      id: string,
      data: ScheduleFormData,
    ): Promise<string | null> => {
      const err = validateScheduleOverlap(data, schedules, id);
      if (err) return err;

      try {
        await updateMutation.mutateAsync({
          id,
          ...data,
          days: data.days as [DayOfWeek, ...DayOfWeek[]],
        });
        return null;
      } catch (e) {
        const msg = e instanceof Error
          ? e.message
          : "Failed to update schedule";
        console.error("[useSchedules] Update failed:", msg);
        return msg;
      }
    },
    [schedules, updateMutation.mutateAsync],
  );

  const toggleSchedule = useMemo(
    () => (id: string, enabled: boolean) => {
      toggleMutation.mutate({ id, enabled });
    },
    [toggleMutation.mutate],
  );

  const removeSchedule = useMemo(
    () => (id: string) => {
      deleteMutation.mutate({ id });
    },
    [deleteMutation.mutate],
  );

  return {
    schedules,
    chargeSchedules,
    blockoutSchedules,
    loading,
    addSchedule,
    updateSchedule,
    toggleSchedule,
    removeSchedule,
  };
}
