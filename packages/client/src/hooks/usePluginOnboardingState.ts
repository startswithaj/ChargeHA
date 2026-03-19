import { useStoredState } from "../lib/storage.ts";

export interface PluginOnboardingState {
  /** Current step ID within the plugin onboarding flow. */
  stepId: string;
  /** Set the current step by string ID. */
  setStepId: (id: string) => void;
  /** Clear all onboarding state for this plugin from localStorage. */
  clear: () => void;
}

/**
 * Hook that persists plugin onboarding wizard state to localStorage.
 * Uses a separate key per plugin (e.g. `plugin-onboarding-tesla`)
 * so it doesn't conflict with the initial setup wizard state.
 */
export function usePluginOnboardingState(
  pluginId: string,
  defaultStepId: string,
): PluginOnboardingState {
  const key = `plugin-onboarding-${pluginId}`;
  const [stepId, setStepId, clear] = useStoredState(key, defaultStepId);

  return { stepId, setStepId, clear };
}
