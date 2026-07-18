import { useCallback, useMemo } from "react";
import { removeStored, useStoredState } from "../lib/storage.ts";
import type { WizardStore } from "../components/Wizard/flow.ts";
import type { WizardNavState } from "@chargeha/shared";

export interface PluginOnboardingStore extends WizardStore {
  /** Clear all onboarding state for this plugin from localStorage. */
  clear: () => void;
}

/** The localStorage key backing a plugin's onboarding run — one place owns the
 *  format so it can't drift between the hook and callers that clear it. */
function onboardingKey(pluginId: string): string {
  return `plugin-onboarding-${pluginId}`;
}

/** Wipe a plugin's onboarding state so the next launch starts a fresh run
 *  rather than resuming a half-finished one. A mid-run reload re-mounts the
 *  wizard without going through the launch, so it still resumes. */
export function clearPluginOnboarding(pluginId: string): void {
  removeStored(onboardingKey(pluginId));
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
  const key = onboardingKey(pluginId);
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
