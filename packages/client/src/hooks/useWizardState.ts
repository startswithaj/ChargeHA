import { useCallback, useMemo } from "react";
import { trpc } from "../trpc.ts";
import type { WizardStore } from "../components/Wizard/flow.ts";
import type { WizardNavState } from "@chargeha/shared";

const EMPTY_STATE: WizardNavState = {
  stepId: "",
  vehicleType: "",
  energyType: "",
};

/**
 * The setup wizard's store, persisted to the database via tRPC.
 * Steps are identified by string IDs (not numeric indices) so the wizard
 * can resume correctly even when the step list changes dynamically.
 */
export function useWizardState(): WizardStore {
  const utils = trpc.useUtils();

  const stateQuery = trpc.wizard.state.useQuery();
  const patchMutation = trpc.wizard.patchState.useMutation();

  const patch = useCallback(
    (next: Partial<WizardNavState>) => {
      // One cache entry, so the step id and the types that decide which steps
      // exist cannot disagree for a render.
      utils.wizard.state.cancel();
      utils.wizard.state.setData(undefined, (prev) => ({
        ...(prev ?? EMPTY_STATE),
        ...next,
      }));
      patchMutation.mutate(next, {
        // Don't leave the client sitting on a step the server never stored —
        // it survives until the next load, then silently jumps backwards.
        onError: () => {
          utils.wizard.state.invalidate();
        },
      });
    },
    [utils, patchMutation],
  );

  const state = useMemo(() => ({
    stepId: stateQuery.data?.stepId || "welcome",
    vehicleType: stateQuery.data?.vehicleType ?? "",
    energyType: stateQuery.data?.energyType ?? "",
  }), [
    stateQuery.data?.stepId,
    stateQuery.data?.vehicleType,
    stateQuery.data?.energyType,
  ]);

  return { state, patch, isLoading: stateQuery.isLoading };
}
