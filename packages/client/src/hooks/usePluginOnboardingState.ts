import { useCallback, useMemo } from "react";
import { removeStored, useStoredState } from "../lib/storage.ts";
import type { WizardStore } from "../components/Wizard/flow.ts";
import type { WizardNavState } from "@chargeha/shared";

export interface PluginOnboardingStore extends WizardStore {
  clear: () => void;
}

// One place owns the localStorage key format so it can't drift between the
// hook and callers that clear it.
function onboardingKey(pluginId: string): string {
  return `plugin-onboarding-${pluginId}`;
}

// So the next launch starts fresh rather than resuming a half-finished run.
// A mid-run reload re-mounts the wizard without going through the launch,
// so it still resumes.
export function clearPluginOnboarding(pluginId: string): void {
  removeStored(onboardingKey(pluginId));
}

// Persisted to localStorage under a per-plugin key so it doesn't conflict
// with the setup wizard's state. The state still names the plugin as the
// selection, because that is what owns its steps.
export function usePluginOnboardingState(
  pluginId: string,
  defaultStepId: string,
  kind: "vehicle" | "energy" | "charger",
): PluginOnboardingStore {
  const key = onboardingKey(pluginId);
  const [stepId, setStepId, clear] = useStoredState(key, defaultStepId);

  const state = useMemo(() => ({
    stepId,
    vehicleType: kind === "vehicle" ? pluginId : null,
    energyType: kind === "energy" ? pluginId : null,
    chargerType: kind === "charger" ? pluginId : null,
    controlPath: null,
  }), [stepId, pluginId, kind]);

  const patch = useCallback(
    (next: Partial<WizardNavState>) => {
      if (next.stepId !== undefined) {
        next.stepId === null ? clear() : setStepId(next.stepId);
      }
    },
    [setStepId, clear],
  );

  return { state, patch, isLoading: false, clear };
}
