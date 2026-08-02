import type { PluginStepDef } from "../../../hostUi.ts";
import type { ChargerPluginOption } from "../../../componentRegistry.ts";
import { tapoSetupStep } from "./TapoSetupStep.tsx";
import { tapoVerifyStep } from "./TapoVerifyStep.tsx";

/** Tapo wizard steps, in order. */
export const tapoWizardSteps: PluginStepDef[] = [tapoSetupStep, tapoVerifyStep];

/** Tapo option metadata for the charger type selection step. */
export const tapoChargerOption: ChargerPluginOption = {
  id: "tapo",
  label: "Tapo Smart Plug",
  description:
    "Switch a standard EVSE on and off with a TP-Link Tapo energy-monitoring " +
    "smart plug (P110/P115). Solar charging at a fixed rate — no smart " +
    "charger required.",
  iconKey: "plug",
};
