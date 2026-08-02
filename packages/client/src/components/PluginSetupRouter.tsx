import { useCallback, useMemo } from "react";
import { trpc } from "../trpc.ts";
import {
  chargerPluginSteps,
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

function resolvePluginKind(
  pluginId: string,
): "vehicle" | "energy" | "charger" {
  if (vehiclePluginSteps[pluginId]) return "vehicle";
  if (energyPluginSteps[pluginId]) return "energy";
  return "charger";
}

/**
 * Plugin setup wizard component. Detects whether the plugin is a vehicle,
 * energy, or charger plugin, renders the wizard shell against
 * localStorage-backed state, and refreshes the plugin list on completion.
 * Plugins are already initialized at server startup, so no on-demand init
 * call is needed here.
 */
export function PluginSetupRouter(
  { pluginId }: PluginSetupRouterProps,
) {
  const { navigate } = useRouter();
  const utils = trpc.useUtils();

  const kind = resolvePluginKind(pluginId);

  // Mark the plugin as owner of its steps so Skip abandons the whole chain.
  const flow: StepDef[] = useMemo(() => {
    const steps = vehiclePluginSteps[pluginId] ?? energyPluginSteps[pluginId] ??
      chargerPluginSteps[pluginId] ?? [];
    return steps.map((step) => ({ ...step, owner: pluginId }));
  }, [pluginId]);

  const store = usePluginOnboardingState(pluginId, flow[0]?.id ?? "", kind);
  const { clear } = store;

  const handleComplete = useCallback(() => {
    clear();
    if (kind === "vehicle") {
      utils.vehicle.list.invalidate();
      utils.vehicle.getPlugins.invalidate();
    } else if (kind === "energy") {
      utils.energy.getPlugins.invalidate();
    } else {
      utils.charger.list.invalidate();
    }
    navigate({ type: "app", page: "settings" });
  }, [clear, kind, utils, navigate]);

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
