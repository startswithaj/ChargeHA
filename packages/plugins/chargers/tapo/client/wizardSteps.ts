import type { PluginStepDef } from "../../../hostUi.ts";
import type { ChargerPluginOption } from "../../../pluginOptions.ts";
import { tapoSetupStep } from "./TapoSetupStep.tsx";
import { tapoVerifyStep } from "./TapoVerifyStep.tsx";

export const tapoWizardSteps: PluginStepDef[] = [tapoSetupStep, tapoVerifyStep];

export const tapoChargerOption: ChargerPluginOption = {
  id: "tapo",
  label: "Tapo P110/115 Smart Plug",
  description:
    "Switch a standard EVSE on and off with a TP-Link Tapo P110 or P115. The " +
    "energy meter is what ChargeHA reads to detect charging, so a plug " +
    "without one will not work. Solar charging at a fixed rate — no smart " +
    "charger required.",
  iconKey: "plug",
};
