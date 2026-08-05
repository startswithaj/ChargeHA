import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { VehicleWithState } from "@chargeha/shared";
import { vehiclePluginOptions } from "@chargeha/plugins/componentRegistry";
import { dataOnlyVehicleAdapterId } from "@chargeha/plugins/demoPluginSummaries";
import { useHomeConfig } from "../../../hooks/useSectionConfig.ts";
import { trpc } from "../../../trpc.ts";
import { useRouter } from "../../../hooks/useRouter.ts";
import { clearPluginOnboarding } from "../../../hooks/usePluginOnboardingState.ts";

const demoPlugin = vehiclePluginOptions.find((o) => o.demoSetup);

// Wizard creates "Demo EV" / DEMO-001; settings-added vehicles continue
// the sequence: "Demo EV 2" / DEMO-002, "Demo EV 3" / DEMO-003, ...
const nextDemoNumber = (vehicles: VehicleWithState[]): number =>
  vehicles.reduce((max, v) => {
    const match = v.id.match(/^DEMO-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0) + 1;

function useAddSimulatedVehicleMutation(
  {
    utils,
    vehicles,
    homeConfig,
    setRecentlyAddedVins,
    adapterType,
    namePrefix,
  }: {
    adapterType: string | undefined;
    namePrefix: string;
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
      if (!demoPlugin || !adapterType) {
        throw new Error("No demo plugin available");
      }
      const n = nextDemoNumber(vehicles);
      const id = `DEMO-${String(n).padStart(3, "0")}`;
      const homeLat = homeConfig?.homeLatitude ?? NaN;
      const homeLng = homeConfig?.homeLongitude ?? NaN;
      const simConfig: Record<string, unknown> = {
        ...demoPlugin.defaultVehicleConfig,
      };
      if (!isNaN(homeLat) && !isNaN(homeLng)) {
        simConfig.homeLat = homeLat;
        simConfig.homeLng = homeLng;
      }
      const name = n === 1 ? namePrefix : `${namePrefix} ${n}`;
      await utils.client.vehicle.create.mutate({
        id,
        name,
        adapterType,
        config: JSON.stringify(simConfig),
      });
      return id;
    },
    onSuccess: (id) => {
      // Cache refresh is driven by the server's vehicles_changed event in RealtimeSync.
      setRecentlyAddedVins(new Set([id]));
      setTimeout(() => setRecentlyAddedVins(new Set()), 4000);
    },
  });
}

export function useVehicleSettings() {
  const { navigate } = useRouter();
  const { data: homeConfig } = useHomeConfig();

  // --- Queries (read side) ---
  const utils = trpc.useUtils();
  const vehiclesQuery = trpc.vehicle.list.useQuery(undefined, {
    select: (data) => data.vehicles as VehicleWithState[],
  });

  // --- Derived values from queries ---
  const vehicles = vehiclesQuery.data ?? [];

  // --- Local UI state ---
  const [recentlyAddedVins, setRecentlyAddedVins] = useState<Set<string>>(
    new Set(),
  );

  // --- Mutations ---

  // No onSuccess cache work: RealtimeSync handles vehicles_changed invalidation.
  const deleteMutation = trpc.vehicle.delete.useMutation();

  const addSimMutation = useAddSimulatedVehicleMutation({
    utils,
    vehicles,
    homeConfig,
    setRecentlyAddedVins,
    adapterType: demoPlugin?.id,
    namePrefix: "Demo EV",
  });
  const addDataOnlyMutation = useAddSimulatedVehicleMutation({
    utils,
    vehicles,
    homeConfig,
    setRecentlyAddedVins,
    adapterType: dataOnlyVehicleAdapterId,
    namePrefix: "Data-Only EV",
  });

  // --- Mutation handlers ---

  const handleDelete = (vin: string) =>
    deleteMutation.mutate({ vehicleId: vin });

  const handleAddSimulatedVehicle = () => addSimMutation.mutate();
  const handleAddDataOnlyVehicle = () => addDataOnlyMutation.mutate();

  // --- Plugin onboarding ---

  const vehiclePluginsQuery = trpc.vehicle.getPlugins.useQuery();
  const vehiclePlugins = vehiclePluginsQuery.data ?? [];

  const handleStartOnboarding = useCallback((pluginId: string) => {
    // Launching from settings is a fresh run, so drop any half-finished state.
    clearPluginOnboarding(pluginId);
    navigate({ type: "pluginSetup", pluginId });
  }, []);

  // Combine query and mutation errors for display
  const mutations = [
    deleteMutation,
    addSimMutation,
    addDataOnlyMutation,
  ];
  const displayError = vehiclesQuery.error?.message ??
    mutations.find((m) => m.error)?.error?.message ?? null;

  return {
    vehicles,
    loading: vehiclesQuery.isPending,
    loadFailed: vehiclesQuery.isError,
    error: displayError,
    recentlyAddedVins,
    handleDelete,
    handleAddSimulatedVehicle,
    handleAddDataOnlyVehicle,
    vehiclePlugins,
    handleStartOnboarding,
  };
}
