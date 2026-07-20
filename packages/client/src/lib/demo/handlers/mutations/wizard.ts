import type { MutationHandlers } from "../types.ts";
import { ALL_DAYS, updateDemoState } from "../../demoState.ts";

type WizardMutations = Pick<
  MutationHandlers,
  | "wizard.complete"
  | "wizard.demoSetup"
  | "wizard.setAuthMode"
  | "wizard.patchState"
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
        energy_adapter_type: "simulated_energy",
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
      // Seed an overnight off-peak charge schedule so the demo shows scheduling.
      schedules: [{
        id: "demo-overnight-charge",
        vehicleId: "DEMO-001",
        scheduleType: "charge",
        startTime: "00:00",
        endTime: "06:00",
        days: ALL_DAYS,
        chargeAmps: 16,
        chargeLimitPct: 80,
        enabled: true,
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

  "wizard.patchState": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: {
        ...m.config,
        ...(input.stepId !== undefined ? { wizard_step: input.stepId } : {}),
        ...(input.vehicleType !== undefined
          ? { wizard_vehicle_type: input.vehicleType }
          : {}),
        ...(input.energyType !== undefined
          ? { wizard_energy_type: input.energyType }
          : {}),
      },
    }));
  },
};
