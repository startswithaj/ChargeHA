import { useCallback, useMemo } from "react";
import { useStoredState } from "../lib/storage.ts";
import type { WizardStore } from "../components/Wizard/flow.ts";
import type { WizardNavState } from "@chargeha/shared";

export interface PluginOnboardingStore extends WizardStore {
  /** Clear all onboarding state for this plugin from localStorage. */
  clear: () => void;
}

/**
 * A plugin's own onboarding run, persisted to localStorage under a per-plugin
 * key (e.g. `plugin-onboarding-tesla`) so it doesn't conflict with the initial
 * setup wizard's state.
 *
 * Only the step id varies — but the state still names the plugin as the
 * selection, because that is what owns its steps. Saying otherwise would gate
 * every one of them out of the list.
 */
export function usePluginOnboardingState(
  pluginId: string,
  defaultStepId: string,
  kind: "vehicle" | "energy",
): PluginOnboardingStore {
  const key = `plugin-onboarding-${pluginId}`;
  const [stepId, setStepId, clear] = useStoredState(key, defaultStepId);

  const state = useMemo(() => ({
    stepId,
    vehicleType: kind === "vehicle" ? pluginId : "",
    energyType: kind === "energy" ? pluginId : "",
  }), [stepId, pluginId, kind]);

  const patch = useCallback(
    (next: Partial<WizardNavState>) => {
      if (next.stepId !== undefined) setStepId(next.stepId);
    },
    [setStepId],
  );

  return { state, patch, isLoading: false, clear };
}
