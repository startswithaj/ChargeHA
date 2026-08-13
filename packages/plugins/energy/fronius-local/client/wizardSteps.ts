import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../pluginOptions.ts";
import { froniusLocalSetupStep } from "./FroniusLocalSetupStep.tsx";

export const froniusLocalWizardSteps: PluginStepDef[] = [froniusLocalSetupStep];

export const froniusLocalOption: EnergyPluginOption = {
  id: "fronius_local",
  label: "Fronius (Local)",
  description:
    "Connect directly to a Fronius inverter on your local network via its built-in API. Requires the inverter to be reachable from this server.",
  iconKey: "server",
};
