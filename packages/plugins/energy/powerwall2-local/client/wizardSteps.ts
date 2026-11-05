import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../pluginOptions.ts";
import { powerwall2LocalSetupStep } from "./Powerwall2LocalSetupStep.tsx";

export const powerwall2LocalWizardSteps: PluginStepDef[] = [
  powerwall2LocalSetupStep,
];

export const powerwall2LocalOption: EnergyPluginOption = {
  id: "powerwall2_local",
  label: "Tesla Powerwall 2 via Gateway (Local)",
  description:
    "Powerwall 2 with Backup Gateway 2 (tested). Gateway 1 untested. Powerwall 3 not supported. Read-only local solar, grid, home and battery telemetry.",
  iconKey: "server",
};
