import { useSyncExternalStore } from "react";
import { createStore } from "../lib/createStore.ts";

/** External store for vehicle API errors, shared between
 * useRealtimeEvents (writes) and useVehicles (reads). */
const store = createStore<Record<string, string>>({});

export const vehicleErrorStore = {
  setError(vehicleId: string, error: string) {
    const current = store.getSnapshot();
    if (current[vehicleId] === error) return;
    store.setState({ ...current, [vehicleId]: error });
  },
  clearError(vehicleId: string) {
    const current = store.getSnapshot();
    if (!(vehicleId in current)) return;
    const { [vehicleId]: _, ...rest } = current;
    store.setState(rest);
  },
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

export function useVehicleErrors(): Record<string, string> {
  return useSyncExternalStore(
    vehicleErrorStore.subscribe,
    vehicleErrorStore.getSnapshot,
  );
}
