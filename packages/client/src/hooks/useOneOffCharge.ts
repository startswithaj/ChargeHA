import { useMemo } from "react";
import type { ChargeSchedule, OneOffChargeFormData } from "@chargeha/shared";
import { trpc } from "../trpc.ts";

/**
 * The pending one-off charges (keyed by vehicle) plus create/cancel actions.
 *
 * One-off charges are stored as dated charge schedules, so they arrive on the
 * same `schedule.list` query as everything else — no extra request.
 */
export function useOneOffCharges() {
  const utils = trpc.useUtils();
  const { data } = trpc.schedule.list.useQuery();

  const createMutation = trpc.schedule.createOneOff.useMutation({
    onSuccess: () => utils.schedule.list.invalidate(),
  });
  const deleteMutation = trpc.schedule.delete.useMutation({
    onSuccess: () => utils.schedule.list.invalidate(),
  });

  const oneOffByVehicle = useMemo(() => {
    const entries = (data?.schedules ?? [])
      .filter((s): s is ChargeSchedule =>
        s.scheduleType === "charge" && !!s.oneOffDate
      )
      .map((s) => [s.vehicleId, s] as const);
    return Object.fromEntries(entries) as Record<string, ChargeSchedule>;
  }, [data?.schedules]);

  const scheduleOneOff = useMemo(
    () =>
    async (
      vehicleId: string,
      form: OneOffChargeFormData,
    ): Promise<string | null> => {
      try {
        await createMutation.mutateAsync({
          vehicleId,
          startTime: form.startTime,
          durationMinutes: form.durationMinutes,
          chargeAmps: form.chargeAmps,
          chargeLimitPct: form.chargeLimitPct,
        });
        return null;
      } catch (e) {
        const msg = e instanceof Error
          ? e.message
          : "Failed to schedule charge";
        console.error("[useOneOffCharges] Create failed:", msg);
        return msg;
      }
    },
    [createMutation.mutateAsync],
  );

  const cancelOneOff = useMemo(
    () => (id: string) => deleteMutation.mutateAsync({ id }),
    [deleteMutation.mutateAsync],
  );

  return {
    schedules: data?.schedules ?? [],
    oneOffByVehicle,
    scheduleOneOff,
    cancelOneOff,
  };
}
