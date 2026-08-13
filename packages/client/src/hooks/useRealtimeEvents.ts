import { useRef } from "react";
import type { SSEEvent } from "@chargeha/shared";
import { trpc } from "../trpc.ts";
import { connectionStatusStore } from "./useConnectionStatus.ts";

type EventData<T extends SSEEvent["type"]> = Extract<
  SSEEvent,
  { type: T }
>["data"];

// Each useSubscription() opens its own EventSource, and StrictMode's
// double-mount can exhaust the browser's 6-connection HTTP/1.1 pool and
// hang refresh. One subscription (onEvents) routes by `type` instead.
export function useRealtimeEvents(handlers: {
  onEnergyUpdate: (data: EventData<"energy_update">) => void;
  onVehicleUpdate: (data: EventData<"vehicle_update">) => void;
  onVehiclesChanged: () => void;
  onVehicleError: (data: EventData<"vehicle_error">) => void;
  onControllerStatus: (data: EventData<"controller_status">) => void;
  onChargerUpdate: (data: EventData<"charger_update">) => void;
  onChargersChanged: () => void;
}) {
  // Use refs so the subscription doesn't re-establish when handlers change
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  trpc.subscription.onEvents.useSubscription(undefined, {
    onData: (event) => {
      connectionStatusStore.setState("connected");
      switch (event.type) {
        case "energy_update":
          handlersRef.current.onEnergyUpdate(event.data);
          break;
        case "vehicle_update":
          handlersRef.current.onVehicleUpdate(event.data);
          break;
        case "vehicles_changed":
          handlersRef.current.onVehiclesChanged();
          break;
        case "vehicle_error":
          handlersRef.current.onVehicleError(event.data);
          break;
        case "controller_status":
          handlersRef.current.onControllerStatus(event.data);
          break;
        case "charger_update":
          handlersRef.current.onChargerUpdate(event.data);
          break;
        case "chargers_changed":
          handlersRef.current.onChargersChanged();
          break;
      }
    },
    onError: () => {
      connectionStatusStore.setState("disconnected");
    },
  });
}
