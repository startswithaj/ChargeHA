import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { VehicleWithState } from "@chargeha/shared";
import { vehiclePluginOptions } from "@chargeha/plugins/componentRegistry";
import { useHomeConfig } from "../../../hooks/useSectionConfig.ts";
import { trpc } from "../../../trpc.ts";
import { useRouter } from "../../../hooks/useRouter.ts";

const demoPlugin = vehiclePluginOptions.find((o) => o.demoSetup);

function useAddSimulatedVehicleMutation(
  { utils, vehicles, homeConfig, setRecentlyAddedVins }: {
    utils: ReturnType<typeof trpc.useUtils>;
    vehicles: VehicleWithState[];
    homeConfig:
      | { homeLatitude?: number | null; homeLongitude?: number | null }
      | undefined;
    setRecentlyAddedVins: (s: Set<string>) => void;
  },
) {
  return useMutation({
    mutationFn: async () => {
      if (!demoPlugin) throw new Error("No demo plugin available");
      const id = `sim-ev-${Math.random().toString(36).slice(2, 10)}`;
      const homeLat = homeConfig?.homeLatitude ?? NaN;
      const homeLng = homeConfig?.homeLongitude ?? NaN;
      const simConfig: Record<string, unknown> = {
        ...demoPlugin.defaultVehicleConfig,
      };
      if (!isNaN(homeLat) && !isNaN(homeLng)) {
        simConfig.homeLat = homeLat;
        simConfig.homeLng = homeLng;
      }
      const baseName = `${demoPlugin.label} EV`;
      const existingCount = vehicles.filter(
        (v) => v.adapterType === demoPlugin.id,
      ).length;
      const name = existingCount === 0
        ? baseName
        : `${baseName} ${existingCount + 1}`;
      await utils.client.vehicle.create.mutate({
        id,
        name,
        adapterType: demoPlugin.id,
        config: JSON.stringify(simConfig),
      });
      return id;
    },
    onSuccess: (id) => {
      utils.vehicle.list.invalidate();
      setRecentlyAddedVins(new Set([id]));
      setTimeout(() => setRecentlyAddedVins(new Set()), 4000);
    },
  });
}

function usePriorityMutation(utils: ReturnType<typeof trpc.useUtils>) {
  const priorityMutationRaw = trpc.vehicle.setPriority.useMutation();
  return useMutation({
    mutationFn: async (updates: Array<{ id: string; priority: number }>) => {
      await Promise.all(
        updates.map(({ id, priority }) =>
          priorityMutationRaw.mutateAsync({ vehicleId: id, priority })
        ),
      );
    },
    onSuccess: () => {
      utils.vehicle.list.invalidate();
    },
  });
}

function computePriorityUpdates(
  vehicles: VehicleWithState[],
  vin: string,
  direction: "up" | "down",
) {
  const sorted = [...vehicles].sort((a, b) => a.priority - b.priority);
  const idx = sorted.findIndex((v) => v.id === vin);
  if (idx < 0) return null;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return null;

  // Swap positions in the sorted array
  const temp = sorted[idx];
  sorted[idx] = sorted[swapIdx];
  sorted[swapIdx] = temp;

  // Assign sequential priorities based on new order
  // (handles duplicate priority values that would make a value-swap a no-op)
  return sorted
    .map((v, i) => ({ id: v.id, priority: i + 1 }))
    .filter((u, i) => sorted[i].priority !== u.priority);
}

export function useVehicleSettings() {
  const { navigate } = useRouter();
  const { data: homeConfig } = useHomeConfig();

  // --- Queries (read side) ---
  const utils = trpc.useUtils();
  const vehiclesQuery = trpc.vehicle.list.useQuery(undefined, {
    select: (data) => data.vehicles as VehicleWithState[],
  });

  const encryptionHealthQuery = trpc.health.encryption.useQuery();

  // --- Derived values from queries ---
  const vehicles = vehiclesQuery.data ?? [];
  const encryptionMissing = encryptionHealthQuery.data
    ? !encryptionHealthQuery.data.configured
    : false;

  // --- Local UI state ---
  const [recentlyAddedVins, setRecentlyAddedVins] = useState<Set<string>>(
    new Set(),
  );

  // --- Mutations ---

  const deleteMutation = trpc.vehicle.delete.useMutation({
    onSuccess: () => {
      utils.vehicle.list.invalidate();
    },
  });

  const priorityMutation = usePriorityMutation(utils);
  const addSimMutation = useAddSimulatedVehicleMutation({
    utils,
    vehicles,
    homeConfig,
    setRecentlyAddedVins,
  });

  // --- Mutation handlers ---

  const handleDelete = (vin: string) =>
    deleteMutation.mutate({ vehicleId: vin });

  const handleMovePriority = (vin: string, direction: "up" | "down") => {
    const updates = computePriorityUpdates(vehicles, vin, direction);
    if (!updates || updates.length === 0) return;
    priorityMutation.mutate(updates);
  };

  const handleAddSimulatedVehicle = () => addSimMutation.mutate();

  // --- Plugin onboarding ---

  const vehiclePluginsQuery = trpc.vehicle.getPlugins.useQuery();
  const vehiclePlugins = vehiclePluginsQuery.data ?? [];

  const handleStartOnboarding = useCallback((pluginId: string) => {
    navigate({ type: "pluginSetup", pluginId });
  }, []);

  // Combine query and mutation errors for display
  const mutations = [deleteMutation, priorityMutation, addSimMutation];
  const displayError = vehiclesQuery.error?.message ??
    mutations.find((m) => m.error)?.error?.message ?? null;

  return {
    vehicles,
    loading: vehiclesQuery.isPending,
    loadFailed: vehiclesQuery.isError,
    error: displayError,
    recentlyAddedVins,
    encryptionMissing,
    handleDelete,
    handleMovePriority,
    handleAddSimulatedVehicle,
    vehiclePlugins,
    handleStartOnboarding,
  };
}
