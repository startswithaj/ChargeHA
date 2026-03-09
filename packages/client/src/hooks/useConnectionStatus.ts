import { useSyncExternalStore } from "react";
import { createStore } from "../lib/createStore.ts";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export const connectionStatusStore = createStore<ConnectionStatus>(
  "connecting",
);

export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(
    connectionStatusStore.subscribe,
    connectionStatusStore.getSnapshot,
  );
}
