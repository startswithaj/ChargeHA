import type {
  EnergyPluginOption,
  PluginWizardStep,
} from "../../../componentRegistry.ts";

/** Sigenergy wizard step definitions for the setup wizard. */
export const sigenergyLocalWizardSteps: PluginWizardStep[] = [
  {
    id: "sigenergy-local-setup",
    label: "Sigenergy Setup",
    componentKey: "sigenergy-local-setup",
  },
];

/** Sigenergy option metadata for the inverter type selection step. */
export const sigenergyLocalOption: EnergyPluginOption = {
  id: "sigenergy_local",
  label: "Sigenergy (Local)",
  description:
    "Connect directly to a Sigenergy inverter on your local network via Modbus TCP. Requires the inverter to be reachable from this server.",
  iconKey: "server",
};
