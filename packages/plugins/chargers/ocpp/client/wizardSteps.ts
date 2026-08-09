import type { PluginStepDef } from "../../../hostUi.ts";
import type { ChargerPluginOption } from "../../../pluginOptions.ts";
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
  // Storage key from the plugin's config definition (ocppChargerId ->
  // charger_id). This is the id the charge point announces on connect, so it
  // is what tells two OCPP chargers apart.
  identityConfigKey: "charger_id",
};
