import { useEffect } from "react";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "../trpc.ts";
import { useVehicleErrors, vehicleErrorStore } from "./vehicleErrorStore.ts";

export function useVehicles() {
  const utils = trpc.useUtils();

  // Per-vehicle API errors from SSE — shared store written by useRealtimeEvents
  const vehicleErrors = useVehicleErrors();

  // --- Query: fetch vehicle list via tRPC ---
  const {
    data: vehiclesData,
    isLoading: loading,
    error: queryError,
  } = trpc.vehicle.list.useQuery(undefined, {
    select: (data) => data.vehicles as VehicleWithState[],
  });
  const vehicles = vehiclesData ?? [];

  // Seed error store from server state so errors survive page refresh.
  // Must be in useEffect — side effects in select cause render loops.
  useEffect(() => {
    vehicles.forEach((v) => {
      if (v.lastError) vehicleErrorStore.setError(v.id, v.lastError);
    });
  }, [vehicles]);

  const error = queryError?.message ?? null;

  // SSE updates are handled by useRealtimeEvents in App.tsx via a single
  // multiplexed connection. It calls updateVehicleCache/updateVehicleError
  // which update the query cache and error state used by this hook.
  const refreshVehicles = () => utils.vehicle.list.invalidate();

  return {
    vehicles,
    loading,
    error,
    vehicleErrors,
    refreshVehicles,
  };
}
