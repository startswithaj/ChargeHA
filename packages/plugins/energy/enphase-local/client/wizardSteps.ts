import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../componentRegistry.ts";
import { enphaseLocalSetupStep } from "./EnphaseLocalSetupStep.tsx";

/** Enphase wizard steps, in order. */
export const enphaseLocalWizardSteps: PluginStepDef[] = [enphaseLocalSetupStep];

/** Enphase option metadata for the inverter type selection step. */
export const enphaseLocalOption: EnergyPluginOption = {
  id: "enphase_local",
  label: "Enphase (Local)",
  description:
    "Connect directly to an Enphase Envoy / IQ Gateway on your local network. Requires firmware 7+ and an Enphase account (or token) for authentication.",
  iconKey: "server",
};
