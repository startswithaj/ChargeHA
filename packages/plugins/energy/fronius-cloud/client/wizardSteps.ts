import type {
  EnergyPluginOption,
  PluginWizardStep,
} from "../../../componentRegistry.ts";

/** Fronius Cloud wizard step definitions for the setup wizard. */
export const froniusCloudWizardSteps: PluginWizardStep[] = [
  {
    id: "fronius-cloud-setup",
    label: "Fronius Cloud Setup",
    componentKey: "fronius-cloud-setup",
  },
];

/** Fronius Cloud option metadata for the inverter type selection step. */
export const froniusCloudOption: EnergyPluginOption = {
  id: "fronius_cloud",
  label: "Fronius (Cloud / Solar.web)",
  description:
    "Connect via Fronius Solar.web cloud API using your login credentials. Works when the inverter is not on the same network.",
  iconKey: "cloud",
};
