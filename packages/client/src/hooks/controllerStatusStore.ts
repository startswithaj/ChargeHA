import { useSyncExternalStore } from "react";
import { createStore } from "../lib/createStore.ts";

interface ControllerStatus {
  action: string;
  reason: string;
  detail: string;
  targetAmps: number | null;
  checksJson: string;
}

/** External store for controller status per vehicle, written by
 * useRealtimeEvents (SSE) and read by VehicleCard. */
const store = createStore<Record<string, ControllerStatus>>({});

export const controllerStatusStore = {
  update(
    vehicleId: string,
    action: string,
    reason: string,
    detail: string,
    targetAmps: number | null,
    checksJson: string,
  ) {
    const current = store.getSnapshot();
    const prev = current[vehicleId];
    if (prev?.action === action && prev?.detail === detail) return;
    store.setState({
      ...current,
      [vehicleId]: { action, reason, detail, targetAmps, checksJson },
    });
  },
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

export function useControllerStatuses(): Record<string, ControllerStatus> {
  return useSyncExternalStore(
    controllerStatusStore.subscribe,
    controllerStatusStore.getSnapshot,
  );
}
