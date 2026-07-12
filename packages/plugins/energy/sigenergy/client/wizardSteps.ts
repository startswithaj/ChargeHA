import type {
  EnergyPluginOption,
  PluginWizardStep,
} from "../../../componentRegistry.ts";

/** Sigenergy wizard step definitions for the setup wizard. */
export const sigenergyWizardSteps: PluginWizardStep[] = [
  {
    id: "sigenergy-setup",
    label: "Sigenergy Setup",
    componentKey: "sigenergy-setup",
  },
];

/** Sigenergy option metadata for the inverter type selection step. */
export const sigenergyOption: EnergyPluginOption = {
  id: "sigenergy",
  label: "Sigenergy",
  description:
    "Connect directly to a Sigenergy inverter on your local network via Modbus TCP. Requires the inverter to be reachable from this server.",
  iconKey: "server",
};
