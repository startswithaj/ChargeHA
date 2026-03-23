import { useEffect, useMemo, useState } from "react";
import type { VehicleChargeState, VehicleMode } from "@chargeha/shared";
import type { VehicleWithState } from "@chargeha/shared";
import { trpc } from "../trpc.ts";
import { useToast } from "./useToast.tsx";
import { useVehicleErrors, vehicleErrorStore } from "./vehicleErrorStore.ts";

type CommandCallbacks = {
  setPending: (vin: string, pending: string | false) => void;
  updateCacheState: (vin: string, state: VehicleChargeState) => void;
};

function useStartChargingMutation(
  { setPending, updateCacheState }: CommandCallbacks,
) {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  return trpc.vehicle.command.useMutation({
    onMutate: ({ vehicleId }) => setPending(vehicleId, "start"),
    onSuccess: (result, { vehicleId }) => {
      if (result.state) updateCacheState(vehicleId, result.state);
      utils.vehicle.list.invalidate();
    },
    onError: (err) =>
      addToast(`Failed to start charging: ${err.message}`, "error"),
    onSettled: (_data, _error, vars) => {
      if (vars) setPending(vars.vehicleId, false);
    },
  });
}

function useStopChargingMutation(
  { setPending, updateCacheState }: CommandCallbacks,
) {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  return trpc.vehicle.command.useMutation({
    onMutate: ({ vehicleId }) => setPending(vehicleId, "stop"),
    onSuccess: (result, { vehicleId }) => {
      if (result.state) updateCacheState(vehicleId, result.state);
      // Backend sets mode to stop — refetch vehicle list to pick up the mode change.
      utils.vehicle.list.invalidate();
    },
    onError: (err) =>
      addToast(`Failed to stop charging: ${err.message}`, "error"),
    onSettled: (_data, _error, vars) => {
      if (vars) setPending(vars.vehicleId, false);
    },
  });
}

function useSetAmpsMutation(
  { setPending, updateCacheState }: CommandCallbacks,
) {
  const { addToast } = useToast();
  return trpc.vehicle.setAmps.useMutation({
    onMutate: ({ vehicleId }) => setPending(vehicleId, "amps"),
    onSuccess: (result, { vehicleId }) => {
      if (result.state) updateCacheState(vehicleId, result.state);
    },
    onError: (err) => addToast(`Failed to set amps: ${err.message}`, "error"),
    onSettled: (_data, _error, vars) => {
      if (vars) setPending(vars.vehicleId, false);
    },
  });
}

function useSetModeMutation(
  { setPending }: Pick<CommandCallbacks, "setPending">,
) {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  return trpc.vehicle.setMode.useMutation({
    onMutate: ({ vehicleId, mode }) => setPending(vehicleId, `mode:${mode}`),
    onSuccess: (_result, { vehicleId, mode }) => {
      utils.vehicle.list.setData(undefined, (old) => {
        if (!old) return old;
        return {
          vehicles: old.vehicles.map((v) =>
            v.id === vehicleId ? { ...v, mode } : v
          ),
        };
      });
    },
    onError: (err) =>
      addToast(`Failed to change mode: ${err.message}`, "error"),
    onSettled: (_data, _error, vars) => {
      if (vars) setPending(vars.vehicleId, false);
    },
  });
}

type CommandCallbackDeps = {
  utils: ReturnType<typeof trpc.useUtils>;
  startMutation: ReturnType<typeof useStartChargingMutation>;
  stopMutation: ReturnType<typeof useStopChargingMutation>;
  ampsMutation: ReturnType<typeof useSetAmpsMutation>;
  modeMutation: ReturnType<typeof useSetModeMutation>;
};

function useCommandCallbacks(
  { utils, startMutation, stopMutation, ampsMutation, modeMutation }:
    CommandCallbackDeps,
) {
  const startCharging = useMemo(
    () => (vin: string) =>
      startMutation
        .mutateAsync({ vehicleId: vin, command: "start" })
        .catch((err) => console.error("startCharging failed:", err)),
    [startMutation.mutateAsync],
  );

  const stopCharging = useMemo(
    () => (vin: string) =>
      stopMutation
        .mutateAsync({ vehicleId: vin, command: "stop" })
        .catch((err) => console.error("stopCharging failed:", err)),
    [stopMutation.mutateAsync],
  );

  const setAmps = useMemo(
    () => (vin: string, amps: number) =>
      ampsMutation
        .mutateAsync({ vehicleId: vin, amps })
        .catch((err) => console.error("setAmps failed:", err)),
    [ampsMutation.mutateAsync],
  );

  const changeMode = useMemo(
    () => (vin: string, mode: VehicleMode) =>
      modeMutation
        .mutateAsync({ vehicleId: vin, mode })
        .catch((err) => console.error("changeMode failed:", err)),
    [modeMutation.mutateAsync],
  );

  const refreshVehicles = useMemo(
    () => () => utils.vehicle.list.invalidate(),
    [utils],
  );

  return { startCharging, stopCharging, setAmps, changeMode, refreshVehicles };
}

export function useVehicles() {
  const utils = trpc.useUtils();

  // Track which mutation is active per vehicle (for commandPending)
  const [pendingCommands, setPendingCommands] = useState<
    Record<string, string | false>
  >({});

  // Per-vehicle API errors from SSE — shared store written by useRealtimeEvents
  const vehicleErrors = useVehicleErrors();

  const setPending = (vin: string, pending: string | false) => {
    setPendingCommands((prev) => ({ ...prev, [vin]: pending }));
  };

  // Helper to update a vehicle's state in the list cache
  const updateCacheState = (vin: string, state: VehicleChargeState) => {
    utils.vehicle.list.setData(undefined, (old) => {
      if (!old) return old;
      return {
        vehicles: old.vehicles.map((v) => v.id === vin ? { ...v, state } : v),
      };
    });
  };

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
  const deps: CommandCallbacks = { setPending, updateCacheState };
  const startMutation = useStartChargingMutation(deps);
  const stopMutation = useStopChargingMutation(deps);
  const ampsMutation = useSetAmpsMutation(deps);
  const modeMutation = useSetModeMutation({ setPending });

  // Derive commandPending from mutation state + manual tracking
  const commandPending = useMemo(() => {
    return Object.fromEntries(
      (vehicles ?? []).map((v) => [v.id, pendingCommands[v.id] ?? false]),
    );
  }, [vehicles, pendingCommands]);

  // Wrap mutations in stable callbacks matching the original API
  const { startCharging, stopCharging, setAmps, changeMode, refreshVehicles } =
    useCommandCallbacks({
      utils,
      startMutation,
      stopMutation,
      ampsMutation,
      modeMutation,
    });

  return {
    vehicles,
    loading,
    error,
    commandPending,
    vehicleErrors,
    startCharging,
    stopCharging,
    setAmps,
    changeMode,
    refreshVehicles,
  };
}
