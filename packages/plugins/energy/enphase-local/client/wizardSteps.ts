import type {
  EnergyPluginOption,
  PluginWizardStep,
} from "../../../componentRegistry.ts";

/** Enphase wizard step definitions for the setup wizard. */
export const enphaseLocalWizardSteps: PluginWizardStep[] = [
  {
    id: "enphase-local-setup",
    label: "Enphase Setup",
    componentKey: "enphase-local-setup",
  },
];

/** Enphase option metadata for the inverter type selection step. */
export const enphaseLocalOption: EnergyPluginOption = {
  id: "enphase_local",
  label: "Enphase (Local)",
  description:
    "Connect directly to an Enphase Envoy / IQ Gateway on your local network. Requires firmware 7+ and an Enphase account (or token) for authentication.",
  iconKey: "server",
};
