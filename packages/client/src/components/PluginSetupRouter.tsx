import { useCallback, useMemo } from "react";
import { trpc } from "../trpc.ts";
import {
  energyPluginSteps,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import { WizardShell } from "./Wizard/WizardShell.tsx";
import type { StepDef } from "./Wizard/flow.ts";
import { usePluginOnboardingState } from "../hooks/usePluginOnboardingState.ts";
import { useRouter } from "../hooks/useRouter.ts";

interface PluginSetupRouterProps {
  pluginId: string;
}

/**
 * Plugin setup wizard component. Detects whether the plugin is a vehicle
 * or energy plugin, renders the wizard shell against localStorage-backed
 * state, and refreshes the plugin list on completion. Plugins are already
 * initialized at server startup, so no on-demand init call is needed here.
 */
export function PluginSetupRouter(
  { pluginId }: PluginSetupRouterProps,
) {
  const { navigate } = useRouter();
  const utils = trpc.useUtils();

  const isVehiclePlugin = !!(vehiclePluginSteps[pluginId]);

  // Stamp the plugin as the owner of its own steps, exactly as wizardFlow does
  // for the setup wizard — that is what makes Skip abandon the whole chain
  // instead of dropping the user on a step that needed the one they skipped.
  const flow: StepDef[] = useMemo(() => {
    const steps = vehiclePluginSteps[pluginId] ?? energyPluginSteps[pluginId] ??
      [];
    return steps.map((step) => ({ ...step, owner: pluginId }));
  }, [pluginId]);

  const store = usePluginOnboardingState(
    pluginId,
    flow[0]?.id ?? "",
    isVehiclePlugin ? "vehicle" : "energy",
  );
  const { clear } = store;

  const handleComplete = useCallback(() => {
    clear();
    if (isVehiclePlugin) {
      utils.vehicle.list.invalidate();
      utils.vehicle.getPlugins.invalidate();
    } else {
      utils.energy.getPlugins.invalidate();
    }
    navigate({ type: "app", page: "settings" });
  }, [clear, isVehiclePlugin, utils, navigate]);

  const handleCancel = useCallback(() => {
    navigate({ type: "app", page: "settings" });
  }, [navigate]);

  if (flow.length === 0) return null;

  return (
    <WizardShell
      flow={flow}
      store={store}
      basePath={`/setup/${pluginId}`}
      onComplete={handleComplete}
      onBackOut={handleCancel}
    />
  );
}
