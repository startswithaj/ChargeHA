import type { PluginStepDef } from "../../../hostUi.ts";
import type { ChargerPluginOption } from "../../../componentRegistry.ts";
import { tapoSetupStep } from "./TapoSetupStep.tsx";
import { tapoVerifyStep } from "./TapoVerifyStep.tsx";

/** Tapo wizard steps, in order. */
export const tapoWizardSteps: PluginStepDef[] = [tapoSetupStep, tapoVerifyStep];

/** Tapo option metadata for the charger type selection step. */
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
