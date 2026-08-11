import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../pluginOptions.ts";
import { froniusCloudSetupStep } from "./FroniusCloudSetupStep.tsx";

export const froniusCloudWizardSteps: PluginStepDef[] = [froniusCloudSetupStep];

export const froniusCloudOption: EnergyPluginOption = {
  id: "fronius_cloud",
  label: "Fronius (Cloud / Solar.web)",
  description:
    "Connect via Fronius Solar.web cloud API using your login credentials. Works when the inverter is not on the same network.",
  iconKey: "cloud",
};
