import { useRef } from "react";
import type { SSEEvent } from "@chargeha/shared";
import { trpc } from "../trpc.ts";
import { connectionStatusStore } from "./useConnectionStatus.ts";

/** Extract the data type for a specific SSEEvent type. */
type EventData<T extends SSEEvent["type"]> = Extract<
  SSEEvent,
  { type: T }
>["data"];

/**
 * Single SSE subscription that multiplexes all real-time events over one
 * EventSource connection.
 *
 * WHY: tRPC's httpSubscriptionLink opens one EventSource per useSubscription()
 * call. Browsers limit HTTP/1.1 to 6 concurrent connections per origin.
 * React StrictMode double-mounts components in dev, briefly doubling
 * connections. With 3 separate subscriptions × 2 mounts = 6 connections,
 * Chrome's pool is exhausted and page refresh hangs forever because the
 * document request has no available connection slot.
 *
 * Even in production (no StrictMode), multiple SSE connections waste slots
 * that other requests need. HTTP/2 would fix this but Deno.serve only
 * supports HTTP/2 over TLS, and the app runs on plain HTTP.
 *
 * SOLUTION: One subscription (onEvents) returns a discriminated union of all
 * event types. This hook routes events to the correct handler by `type` field.
 * One connection, fully typed, no pool issues.
 *
 * Call this hook once at the App level. Pass handlers for energy, vehicle
 * update, and vehicle error events.
 */
export function useRealtimeEvents(handlers: {
  onEnergyUpdate: (data: EventData<"energy_update">) => void;
  onVehicleUpdate: (data: EventData<"vehicle_update">) => void;
  onVehicleError: (data: EventData<"vehicle_error">) => void;
  onControllerStatus: (data: EventData<"controller_status">) => void;
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
        case "vehicle_error":
          handlersRef.current.onVehicleError(event.data);
          break;
        case "controller_status":
          handlersRef.current.onControllerStatus(event.data);
          break;
      }
    },
    onError: () => {
      connectionStatusStore.setState("disconnected");
    },
  });
}
