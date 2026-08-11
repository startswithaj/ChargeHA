import type { PluginStepDef } from "../../../hostUi.ts";
import type { ChargerPluginOption } from "../../../pluginOptions.ts";

// No setup step: the row is created the moment the type is selected
// (ensureOnSelect) — there is nothing to configure during the wizard.
export const simulatedChargerWizardSteps: PluginStepDef[] = [];

export const simulatedChargerOption: ChargerPluginOption = {
  id: "simulated_charger",
  label: "Simulated Charger",
  description:
    "A virtual smart charger for testing — no hardware required. Exercises " +
    "amps modulation, mode/priority and blockout the same way a real smart " +
    "charger would.",
  iconKey: "monitor",
  directAdd: true,
  ensureOnSelect: true,
  demoAvailable: true,
};
