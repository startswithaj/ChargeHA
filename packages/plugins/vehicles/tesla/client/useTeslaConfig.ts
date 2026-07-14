import { useCallback, useRef, useState } from "react";
import { trpc } from "./trpc.ts";

interface SaveStatus {
  state: "idle" | "saving" | "saved" | "error";
  message?: string;
}

const SAVING_DELAY_MS = 300;

export function useTeslaConfig() {
  return trpc.plugin.vehicle.tesla.getConfig.useQuery();
}

export function useTeslaConfigMutation() {
  const utils = trpc.useUtils();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMutate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
    savingTimerRef.current = setTimeout(
      () => setSaveStatus({ state: "saving" }),
      SAVING_DELAY_MS,
    );
  }, []);

  const onSuccess = useCallback(() => {
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
    setSaveStatus({ state: "saved" });
    timerRef.current = setTimeout(
      () => setSaveStatus({ state: "idle" }),
      2000,
    );
  }, []);

  const onError = useCallback((err: unknown) => {
    if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
    setSaveStatus({
      state: "error",
      message: err instanceof Error ? err.message : "Failed to save",
    });
    timerRef.current = setTimeout(
      () => setSaveStatus({ state: "idle" }),
      5000,
    );
  }, []);

  const mutation = trpc.plugin.vehicle.tesla.setConfig.useMutation({
    onMutate,
    onSuccess: () => {
      utils.plugin.vehicle.tesla.getConfig.invalidate();
      onSuccess();
    },
    onError,
  });

  return { ...mutation, saveStatus };
}
