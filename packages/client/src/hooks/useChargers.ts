import { useState } from "react";
import type { ChargingPointMode } from "@chargeha/shared";
import { type RouterOutputs, trpc } from "../trpc.ts";
import { useToast } from "./useToast.tsx";

export type ChargerWithState = RouterOutputs["charger"]["list"][number];

// A smart charger controls whatever is plugged into it; a vehicle-API
// charging point is bound to one car.
export const isSmartCharger = (charger: ChargerWithState): boolean =>
  charger.kind === "smart";

// Kept fresh by chargers_changed + charger_update SSE events (see
// RealtimeSync).
export function useChargers() {
  const query = trpc.charger.list.useQuery();
  return {
    chargers: query.data ?? [],
    isLoading: query.isLoading,
  };
}

export function useChargingPointForVehicle(vehicleId: string) {
  const { chargers } = useChargers();
  return chargers.find((c) => c.vehicleId === vehicleId) ?? null;
}

type ChargerCommandPending =
  | "start"
  | "stop"
  | "amps"
  | `mode:${ChargingPointMode}`
  | false;

// The dashboard's replacement for the removed
// vehicle.setMode/setAmps/command mutations.
export function useChargerCommands(chargerId: string | null) {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const [commandPending, setCommandPending] = useState<ChargerCommandPending>(
    false,
  );

  const setModeMutation = trpc.charger.setMode.useMutation({
    onSuccess: () => utils.charger.list.invalidate(),
    onError: (err) =>
      addToast(`Failed to change mode: ${err.message}`, "error"),
    onSettled: () => setCommandPending(false),
  });

  const setAmpsMutation = trpc.charger.setAmps.useMutation({
    onSuccess: () => utils.charger.list.invalidate(),
    onError: (err) => addToast(`Failed to set amps: ${err.message}`, "error"),
    onSettled: () => setCommandPending(false),
  });

  const setMode = (mode: ChargingPointMode, pending: ChargerCommandPending) => {
    if (!chargerId) return;
    setCommandPending(pending);
    setModeMutation.mutate({ id: chargerId, mode });
  };

  return {
    commandPending,
    startCharging: () => setMode("charge_now", "start"),
    stopCharging: () => setMode("stop", "stop"),
    changeMode: (mode: ChargingPointMode) => setMode(mode, `mode:${mode}`),
    setAmps: (amps: number) => {
      if (!chargerId) return;
      setCommandPending("amps");
      setAmpsMutation.mutate({ id: chargerId, amps });
    },
  };
}
