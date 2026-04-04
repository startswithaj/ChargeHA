import { useCallback, useRef, useState } from "react";
import { trpc } from "../trpc.ts";

// ── Save status tracking ────────────────────────────────────────────────────

export interface SaveStatus {
  state: "idle" | "saving" | "saved" | "error";
  message?: string;
  /** Monotonic counter — changes on each save/error so animations can re-trigger */
  tick: number;
}

/**
 * Wraps a tRPC mutation hook with save status tracking.
 * Returns the mutation + a `saveStatus` object for the Section header.
 */
const SAVING_DELAY_MS = 300;

export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle", tick: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef(0);

  const onMutate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
    // Only show "saving" if mutation takes longer than 300ms
    savingTimerRef.current = setTimeout(
      () => setStatus({ state: "saving", tick: tickRef.current }),
      SAVING_DELAY_MS,
    );
  }, []);

  const onSuccess = useCallback(() => {
    tickRef.current++;
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
    setStatus({ state: "saved", tick: tickRef.current });
    timerRef.current = setTimeout(
      () => setStatus({ state: "idle", tick: tickRef.current }),
      2000,
    );
  }, []);

  const onError = useCallback((err: unknown) => {
    tickRef.current++;
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
    setStatus({
      state: "error",
      tick: tickRef.current,
      message: err instanceof Error ? err.message : "Failed to save",
    });
    timerRef.current = setTimeout(
      () => setStatus({ state: "idle", tick: tickRef.current }),
      5000,
    );
  }, []);

  return { saveStatus: status, onMutate, onSuccess, onError };
}

// ── Charging ────────────────────────────────────────────────────────────────

export function useChargingConfig() {
  return trpc.config.charging.get.useQuery();
}

export function useChargingConfigMutation() {
  const utils = trpc.useUtils();
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();
  const mutation = trpc.config.charging.set.useMutation({
    onMutate,
    onSuccess: () => {
      utils.config.charging.get.invalidate();
      onSuccess();
    },
    onError,
  });
  return { ...mutation, saveStatus };
}

// ── Solar ───────────────────────────────────────────────────────────────────

export function useSolarConfig() {
  return trpc.config.solar.get.useQuery();
}

export function useSolarConfigMutation() {
  const utils = trpc.useUtils();
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();
  const mutation = trpc.config.solar.set.useMutation({
    onMutate,
    onSuccess: () => {
      utils.config.solar.get.invalidate();
      onSuccess();
    },
    onError,
  });
  return { ...mutation, saveStatus };
}

// ── Battery ─────────────────────────────────────────────────────────────────

export function useBatteryConfig() {
  return trpc.config.battery.get.useQuery();
}

export function useBatteryConfigMutation() {
  const utils = trpc.useUtils();
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();
  const mutation = trpc.config.battery.set.useMutation({
    onMutate,
    onSuccess: () => {
      utils.config.battery.get.invalidate();
      onSuccess();
    },
    onError,
  });
  return { ...mutation, saveStatus };
}

// ── Home ────────────────────────────────────────────────────────────────────

export function useHomeConfig() {
  return trpc.config.home.get.useQuery();
}

export function useHomeConfigMutation() {
  const utils = trpc.useUtils();
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();
  const mutation = trpc.config.home.set.useMutation({
    onMutate,
    onSuccess: () => {
      utils.config.home.get.invalidate();
      onSuccess();
    },
    onError,
  });
  return { ...mutation, saveStatus };
}

// ── Equipment ───────────────────────────────────────────────────────────────

export function useEquipmentConfig() {
  return trpc.config.equipment.get.useQuery();
}

export function useEquipmentConfigMutation() {
  const utils = trpc.useUtils();
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();
  const mutation = trpc.config.equipment.set.useMutation({
    onMutate,
    onSuccess: () => {
      utils.config.equipment.get.invalidate();
      onSuccess();
    },
    onError,
  });
  return { ...mutation, saveStatus };
}

// ── System ──────────────────────────────────────────────────────────────────

export function useSystemConfig() {
  return trpc.config.system.get.useQuery();
}

export function useSystemConfigMutation() {
  const utils = trpc.useUtils();
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();
  const mutation = trpc.config.system.set.useMutation({
    onMutate,
    onSuccess: () => {
      utils.config.system.get.invalidate();
      onSuccess();
    },
    onError,
  });
  return { ...mutation, saveStatus };
}

// ── Notification ────────────────────────────────────────────────────────────

export function useNotificationConfig() {
  return trpc.config.notification.get.useQuery();
}

export function useNotificationConfigMutation() {
  const utils = trpc.useUtils();
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();
  const mutation = trpc.config.notification.set.useMutation({
    onMutate,
    onSuccess: () => {
      utils.config.notification.get.invalidate();
      onSuccess();
    },
    onError,
  });
  return { ...mutation, saveStatus };
}
