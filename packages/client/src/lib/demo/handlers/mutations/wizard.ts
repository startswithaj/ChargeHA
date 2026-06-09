import type { MutationHandlers } from "../types.ts";
import { updateDemoState } from "../../demoState.ts";

type WizardMutations = Pick<
  MutationHandlers,
  | "wizard.complete"
  | "wizard.demoSetup"
  | "wizard.setAuthMode"
  | "wizard.setStep"
  | "wizard.setVehicleType"
  | "wizard.setEnergyType"
>;

export const wizardMutations: WizardMutations = {
  "wizard.complete": () => {
    updateDemoState((m) => ({
      ...m,
      config: {
        ...m.config,
        wizard_completed: "true",
        wizard_step: "",
        wizard_vehicle_type: "",
        wizard_energy_type: "",
      },
    }));
    return { completed: true };
  },

  "wizard.demoSetup": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: {
        ...m.config,
        energy_adapter_type: "",
        timezone: input.timezone ?? m.config.timezone,
      },
      vehicles: [{
        id: "DEMO-001",
        name: "Demo EV",
        adapterType: input.adapterType,
        priority: 1,
        mode: "auto",
        batteryCapacityKwh: 60,
        chargeLimitPercent: 80,
        socPercent: 55,
        isCharging: false,
        isPluggedIn: true,
        chargeAmps: 16,
      }],
    }));
    return { success: true as const };
  },

  "wizard.setAuthMode": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: { ...m.config, auth_mode: input.mode },
      authenticated: input.mode !== "none",
    }));
    return { success: true as const };
  },

  "wizard.setStep": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: { ...m.config, wizard_step: input.stepId },
    }));
  },

  "wizard.setVehicleType": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: { ...m.config, wizard_vehicle_type: input.type },
    }));
  },

  "wizard.setEnergyType": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: { ...m.config, wizard_energy_type: input.type },
    }));
  },
};
