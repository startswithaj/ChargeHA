import { useCallback } from "react";
import { trpc } from "../trpc.ts";

export interface WizardState {
  /** Current step ID (e.g. "welcome", "tesla-credentials"). */
  stepId: string;
  /** Selected vehicle type (e.g. "tesla", "simulated"). */
  vehicleType: string;
  /** Selected energy type (e.g. "fronius_local", "fronius_cloud", ""). */
  energyType: string;
  /** Set the current step by string ID. */
  setStepId: (id: string) => void;
  /** Set the selected vehicle type. */
  setVehicleType: (type: string) => void;
  /** Set the selected energy type. */
  setEnergyType: (type: string) => void;
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

  const stepMutation = trpc.wizard.setStep.useMutation({
    onMutate: async ({ stepId }) => {
      await utils.wizard.getStep.cancel();
      utils.wizard.getStep.setData(undefined, stepId);
    },
  });

  const vehicleTypeMutation = trpc.wizard.setVehicleType.useMutation({
    onMutate: async ({ type }) => {
      await utils.wizard.getVehicleType.cancel();
      utils.wizard.getVehicleType.setData(undefined, type);
    },
  });

  const energyTypeMutation = trpc.wizard.setEnergyType.useMutation({
    onMutate: async ({ type }) => {
      await utils.wizard.getEnergyType.cancel();
      utils.wizard.getEnergyType.setData(undefined, type);
    },
  });

  const setStepId = useCallback(
    (id: string) => stepMutation.mutate({ stepId: id }),
    [stepMutation],
  );

  const setVehicleType = useCallback(
    (type: string) => vehicleTypeMutation.mutate({ type }),
    [vehicleTypeMutation],
  );

  const setEnergyType = useCallback(
    (type: string) => energyTypeMutation.mutate({ type }),
    [energyTypeMutation],
  );

  return {
    stepId: stepQuery.data || "welcome",
    vehicleType: vehicleTypeQuery.data || "",
    energyType: energyTypeQuery.data || "",
    setStepId,
    setVehicleType,
    setEnergyType,
    isLoading: stepQuery.isLoading || vehicleTypeQuery.isLoading ||
      energyTypeQuery.isLoading,
  };
}
