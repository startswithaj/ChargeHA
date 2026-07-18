import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../componentRegistry.ts";
import { sigenergyLocalSetupStep } from "./SigenergyLocalSetupStep.tsx";

/** Sigenergy wizard steps, in order. */
export const sigenergyLocalWizardSteps: PluginStepDef[] = [
  sigenergyLocalSetupStep,
];

/** Sigenergy option metadata for the inverter type selection step. */
export const sigenergyLocalOption: EnergyPluginOption = {
  id: "sigenergy_local",
  label: "Sigenergy (Local)",
  description:
    "Connect directly to a Sigenergy inverter on your local network via Modbus TCP. Requires the inverter to be reachable from this server.",
  iconKey: "server",
};
