import { useCallback } from "react";
import { trpc } from "../trpc.ts";

export interface WizardState {
  /** Current step ID (e.g. "welcome", "tesla-credentials"). */
  stepId: string;
  /** Selected vehicle type (e.g. "tesla", "simulated"). */
  vehicleType: string;
  /** Selected energy type (e.g. "fronius_local", "fronius_cloud", ""). */
  energyType: string;
  /** Move to a step within the current (unchanged) step list. */
  setStepId: (id: string) => void;
  /** Atomically change the vehicle/energy selection and the current step. The
   *  step list is derived from the selected types, so the type change and the
   *  step change must land in one render — writing them separately produces a
   *  frame where stepId points at a step the list hasn't gained yet, which
   *  WizardShell misreads as a corrupt id and "heals" by snapping back. */
  commitSelection: (
    next: { stepId: string; vehicleType?: string; energyType?: string },
  ) => void;
  /** Whether the initial data has loaded from the server. */
  isLoading: boolean;
}

/**
 * Hook that persists wizard navigation state to the database via tRPC.
 * Steps are identified by string IDs (not numeric indices) so the wizard
 * can resume correctly even when the step list changes dynamically.
 */
export function useWizardState(): WizardState {
  const utils = trpc.useUtils();

  const stepQuery = trpc.wizard.getStep.useQuery();
  const vehicleTypeQuery = trpc.wizard.getVehicleType.useQuery();
  const energyTypeQuery = trpc.wizard.getEnergyType.useQuery();

  const stepMutation = trpc.wizard.setStep.useMutation();
  const vehicleTypeMutation = trpc.wizard.setVehicleType.useMutation();
  const energyTypeMutation = trpc.wizard.setEnergyType.useMutation();

  const setStepId = useCallback(
    (id: string) => {
      // Optimistic write is synchronous (no awaited cancel beforehand) so it
      // commits in the same render as any sibling write in the same call stack.
      utils.wizard.getStep.cancel();
      utils.wizard.getStep.setData(undefined, id);
      stepMutation.mutate({ stepId: id });
    },
    [utils, stepMutation],
  );

  const commitSelection = useCallback(
    (next: { stepId: string; vehicleType?: string; energyType?: string }) => {
      // All optimistic cache writes run synchronously in one call so React
      // batches them into a single commit — the step id and the type that puts
      // that step in the list are never out of sync for a render.
      utils.wizard.getStep.cancel();
      utils.wizard.getStep.setData(undefined, next.stepId);
      stepMutation.mutate({ stepId: next.stepId });

      if (next.vehicleType !== undefined) {
        utils.wizard.getVehicleType.cancel();
        utils.wizard.getVehicleType.setData(undefined, next.vehicleType);
        vehicleTypeMutation.mutate({ type: next.vehicleType });
      }
      if (next.energyType !== undefined) {
        utils.wizard.getEnergyType.cancel();
        utils.wizard.getEnergyType.setData(undefined, next.energyType);
        energyTypeMutation.mutate({ type: next.energyType });
      }
    },
    [utils, stepMutation, vehicleTypeMutation, energyTypeMutation],
  );

  return {
    stepId: stepQuery.data || "welcome",
    vehicleType: vehicleTypeQuery.data || "",
    energyType: energyTypeQuery.data || "",
    setStepId,
    commitSelection,
    isLoading: stepQuery.isLoading || vehicleTypeQuery.isLoading ||
      energyTypeQuery.isLoading,
  };
}
