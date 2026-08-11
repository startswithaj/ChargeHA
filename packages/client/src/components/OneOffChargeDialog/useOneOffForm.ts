import { useEffect, useMemo, useState } from "react";
import type {
  ChargeSchedule,
  OneOffChargeFormData,
  Schedule,
  VehicleChargeState,
  VehicleMode,
} from "@chargeha/shared";
import {
  ONE_OFF_DEFAULT_MINUTES,
  ONE_OFF_DEFAULT_START,
  oneOffDurationMinutes,
  resolveOneOffWindow,
} from "@chargeha/shared/oneOffCharge";
import {
  estimateChargeCost,
  resolveChargePhases,
  resolveChargeVoltage,
} from "@chargeha/shared/chargeCostEstimate";
import {
  useSolarConfig,
  useSystemConfig,
} from "../../hooks/useSectionConfig.ts";
import { trpc } from "../../trpc.ts";
import { getOneOffWarnings } from "./oneOffWarnings.ts";

const DEFAULT_GRID_VOLTAGE = 230;

/** Hold a current inside the vehicle's configured amp range. */
function clampAmps(
  amps: number,
  { chargeAmpsMin, chargeAmpsMax }: VehicleChargeState,
): number {
  return Math.min(Math.max(amps, chargeAmpsMin), chargeAmpsMax);
}

/** The pending one-off charge for a vehicle, if it has one. */
export function findPendingOneOff(
  schedules: Schedule[],
  vehicleId: string,
): ChargeSchedule | undefined {
  return schedules.find((s): s is ChargeSchedule =>
    s.scheduleType === "charge" && s.vehicleId === vehicleId &&
    !!s.oneOffDate
  );
}

/** Form state for the one-off charge dialog, plus the derived window, cost
 *  estimate and clash warnings that follow from it. */
export function useOneOffForm(
  { open, vehicleId, state, mode, schedules }: {
    open: boolean;
    vehicleId: string;
    state: VehicleChargeState;
    mode: VehicleMode;
    schedules: Schedule[];
  },
) {
  const { data: systemConfig } = useSystemConfig();
  const { data: solarConfig } = useSolarConfig();
  const { data: tariffs } = trpc.tariff.list.useQuery();
  const timezone = systemConfig?.timezone ?? "";

  const pending = findPendingOneOff(schedules, vehicleId);

  const defaults = (): OneOffChargeFormData => ({
    startTime: pending?.startTime ?? ONE_OFF_DEFAULT_START,
    durationMinutes: pending
      ? oneOffDurationMinutes(pending.startTime, pending.endTime)
      : ONE_OFF_DEFAULT_MINUTES,
    // A pending charge may have been saved when the vehicle's configured amp
    // range was wider, so clamp rather than seeding an out-of-range value.
    chargeAmps: clampAmps(
      pending?.chargeAmps ?? state.chargeAmpsMax,
      state,
    ),
    chargeLimitPct: pending?.chargeLimitPct ?? Math.round(state.chargeLimit),
    switchToAuto: true,
  });

  const [form, setForm] = useState<OneOffChargeFormData>(defaults);

  // Re-seed from the pending charge (or defaults) each time the dialog opens
  useEffect(() => {
    if (open) setForm(defaults());
  }, [open, pending?.id]);

  const window = useMemo(
    () =>
      resolveOneOffWindow(
        form.startTime,
        form.durationMinutes,
        new Date(),
        timezone,
      ),
    [form.startTime, form.durationMinutes, timezone],
  );

  const estimate = useMemo(() => {
    if (!tariffs) return null;
    return estimateChargeCost({
      amps: form.chargeAmps,
      volts: resolveChargeVoltage(
        state,
        solarConfig?.gridVoltage ?? DEFAULT_GRID_VOLTAGE,
      ),
      phases: resolveChargePhases(
        state,
        solarConfig?.threePhaseCharger ?? false,
      ),
      durationMinutes: form.durationMinutes,
      startDate: window.oneOffDate,
      startTime: form.startTime,
      tariffPeriods: tariffs.periods,
      defaultRatePerKwh: tariffs.defaultRatePerKwh,
    });
  }, [tariffs, solarConfig, state, form, window.oneOffDate]);

  const warnings = getOneOffWarnings({
    window,
    startTime: form.startTime,
    durationMinutes: form.durationMinutes,
    mode,
    schedules,
    excludeId: pending?.id,
  });

  const updateField = <K extends keyof OneOffChargeFormData>(
    key: K,
    value: OneOffChargeFormData[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  return {
    form,
    updateField,
    window,
    estimate,
    warnings,
    pending,
    currencySymbol: tariffs?.currencySymbol ?? "$",
  };
}
