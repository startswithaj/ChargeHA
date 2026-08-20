import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../pluginOptions.ts";
import { goodweSemsSetupStep } from "./GoodweSemsSetupStep.tsx";

export const goodweSemsWizardSteps: PluginStepDef[] = [goodweSemsSetupStep];

export const goodweSemsOption: EnergyPluginOption = {
  id: "goodwe_sems",
  label: "GoodWe (Cloud / SEMS Portal)",
  description:
    "Connect via your GoodWe account login. Supports the legacy SEMS Portal " +
    "and the newer SEMS+ backend. Requires a GoodWe HomeKit or smart meter " +
    "for grid and consumption readings.",
  iconKey: "cloud",
};
