// Plugin name/vendor metadata for demo mode, where there is no server to list
// registered plugins. Lives in plugins/ because it names plugin IDs (the
// no-plugin-refs rule scopes those to plugins/). Plain data, no React imports,
// so the demo's handlers stay importable by the Deno coverage test.
// `configured` is added at runtime from demo state.

export interface DemoVehiclePluginSummary {
  id: string;
  displayName: string;
  settingsComponentKey: string | null;
}

export interface DemoEnergyPluginSummary {
  id: string;
  displayName: string;
  vendor: string;
  settingsComponentKey: string | null;
}

export const demoVehiclePluginSummaries: DemoVehiclePluginSummary[] = [
  { id: "tesla", displayName: "Tesla", settingsComponentKey: "tesla-settings" },
  {
    id: "simulated",
    displayName: "Simulated",
    settingsComponentKey: "simulated-settings",
  },
];

export const demoEnergyPluginSummaries: DemoEnergyPluginSummary[] = [
  {
    id: "fronius_local",
    displayName: "Fronius (Local)",
    vendor: "Fronius",
    settingsComponentKey: "fronius-local-config",
  },
  {
    id: "fronius_cloud",
    displayName: "Fronius (Cloud)",
    vendor: "Fronius",
    settingsComponentKey: "fronius-cloud-config",
  },
  {
    id: "goodwe_sems",
    displayName: "GoodWe (Cloud / SEMS Portal)",
    vendor: "GoodWe",
    settingsComponentKey: "goodwe-sems-config",
  },
  {
    id: "simulated_energy",
    displayName: "Simulated",
    vendor: "ChargeHA",
    settingsComponentKey: "simulated-energy-config",
  },
];

/** Vehicle adapters whose plugin also has the charger role. */
export const chargerCapableVehicleAdapters: readonly string[] = [
  "tesla",
  "simulated",
];

export const demoChargerDisplayNames: Record<string, string> = {
  simulated_charger: "Simulated Charger",
  tapo: "Tapo P110/115 Smart Plug",
  ocpp: "OCPP Charger",
};
