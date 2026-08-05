import type { PluginStepDef } from "../../../hostUi.ts";
import type { ChargerPluginOption } from "../../../componentRegistry.ts";
import { simulatedChargerSetupStep } from "./SimulatedChargerSetupStep.tsx";

export const simulatedChargerWizardSteps: PluginStepDef[] = [
  simulatedChargerSetupStep,
];

export const simulatedChargerOption: ChargerPluginOption = {
  id: "simulated_charger",
  label: "Simulated Charger",
  description:
    "A virtual smart charger for testing — no hardware required. Exercises " +
    "amps modulation, mode/priority and blockout the same way a real smart " +
    "charger would.",
  iconKey: "monitor",
  directAdd: true,
  demoAvailable: true,
};
