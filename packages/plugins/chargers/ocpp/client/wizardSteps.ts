import type { PluginStepDef } from "../../../hostUi.ts";
import type { ChargerPluginOption } from "../../../componentRegistry.ts";
import { ocppSetupStep } from "./OcppSetupStep.tsx";

export const ocppWizardSteps: PluginStepDef[] = [ocppSetupStep];

export const ocppChargerOption: ChargerPluginOption = {
  id: "ocpp",
  label: "OCPP Smart Charger",
  description:
    "Connect any OCPP 1.6 compatible charger (Wallbox, MG, ZJ Beny and 20+ " +
    "brands) over your local network. The charger connects to ChargeHA — no " +
    "cloud required.",
  iconKey: "server",
};
