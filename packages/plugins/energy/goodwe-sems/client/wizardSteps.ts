import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../pluginOptions.ts";
import { goodweSemsSetupStep } from "./GoodweSemsSetupStep.tsx";

export const goodweSemsWizardSteps: PluginStepDef[] = [goodweSemsSetupStep];

export const goodweSemsOption: EnergyPluginOption = {
  id: "goodwe_sems",
  label: "GoodWe (Cloud / SEMS Portal)",
  description:
    "Connect via the GoodWe SEMS Portal using your account login. Requires a " +
    "GoodWe HomeKit or smart meter for grid and consumption readings.",
  iconKey: "cloud",
};
