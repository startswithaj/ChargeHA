import { useCallback } from "react";
import { trpc } from "../trpc.ts";
import {
  energyPluginOptions,
  energyPluginSteps,
  vehiclePluginOptions,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import { PluginOnboardingWizard } from "./PluginOnboardingWizard/PluginOnboardingWizard.tsx";
import type { Route } from "../hooks/useRouter.ts";

interface PluginSetupRouterProps {
  pluginId: string;
  navigate: (route: Route) => void;
}

/**
 * Plugin setup wizard component. Detects whether the plugin is a vehicle
 * or energy plugin, renders PluginOnboardingWizard, and refreshes the
 * plugin list on completion. Plugins are already initialized at server
 * startup, so no on-demand init call is needed here.
 */
export function PluginSetupRouter(
  { pluginId, navigate }: PluginSetupRouterProps,
) {
  const utils = trpc.useUtils();

  const isVehiclePlugin = !!(vehiclePluginSteps[pluginId]);

  const handleComplete = useCallback(() => {
    if (isVehiclePlugin) {
      utils.vehicle.list.invalidate();
      utils.vehicle.getPlugins.invalidate();
    } else {
      utils.energy.getPlugins.invalidate();
    }
    navigate({ type: "app", page: "settings" });
  }, [isVehiclePlugin, utils, navigate]);

  const handleCancel = useCallback(() => {
    navigate({ type: "app", page: "settings" });
  }, [navigate]);

  const pluginName = [...vehiclePluginOptions, ...energyPluginOptions]
    .find((p) => p.id === pluginId)?.label ?? pluginId;

  const steps = vehiclePluginSteps[pluginId] ??
    energyPluginSteps[pluginId] ?? [];

  return (
    <PluginOnboardingWizard
      pluginId={pluginId}
      pluginName={pluginName}
      steps={steps}
      onComplete={handleComplete}
      onCancel={handleCancel}
    />
  );
}
