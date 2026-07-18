import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../componentRegistry.ts";
import { froniusCloudSetupStep } from "./FroniusCloudSetupStep.tsx";

/** Fronius Cloud wizard steps, in order. */
export const froniusCloudWizardSteps: PluginStepDef[] = [froniusCloudSetupStep];

/** Fronius Cloud option metadata for the inverter type selection step. */
export const froniusCloudOption: EnergyPluginOption = {
  id: "fronius_cloud",
  label: "Fronius (Cloud / Solar.web)",
  description:
    "Connect via Fronius Solar.web cloud API using your login credentials. Works when the inverter is not on the same network.",
  iconKey: "cloud",
};
