import type {
  EnergyPluginOption,
  PluginWizardStep,
} from "../../../componentRegistry.ts";

/** Simulated energy has no setup step — it works with sensible defaults. */
export const simulatedEnergyWizardSteps: PluginWizardStep[] = [];

/** Simulated energy option metadata for the inverter type selection step. */
export const simulatedEnergyOption: EnergyPluginOption = {
  id: "simulated_energy",
  label: "Simulated",
  description:
    "Generates a realistic solar, home and grid curve with no hardware. Useful for trying out ChargeHA or running the demo.",
  iconKey: "monitor",
  demoAvailable: true,
};
