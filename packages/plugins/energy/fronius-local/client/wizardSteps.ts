import type {
  EnergyPluginOption,
  PluginWizardStep,
} from "../../../componentRegistry.ts";

/** Fronius Local wizard step definitions for the setup wizard. */
export const froniusLocalWizardSteps: PluginWizardStep[] = [
  {
    id: "fronius-local-setup",
    label: "Fronius Local Setup",
    componentKey: "fronius-local-setup",
  },
];

/** Fronius Local option metadata for the inverter type selection step. */
export const froniusLocalOption: EnergyPluginOption = {
  id: "fronius_local",
  label: "Fronius (Local)",
  description:
    "Connect directly to a Fronius inverter on your local network via its built-in API. Requires the inverter to be reachable from this server.",
  iconKey: "server",
};
