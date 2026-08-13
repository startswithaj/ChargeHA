export interface EnergyPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "cloud" | "monitor";
  demoAvailable?: boolean;
}

export interface PluginSettingsProps {
  chargerId?: string | null;
}

export interface PluginScheduleNote {
  adapterType: string;
  text: string;
}

export interface VehiclePluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "car" | "monitor";
  demoAvailable?: boolean;
  demoSetup?: boolean;
  defaultVehicleConfig?: Record<string, unknown>;
}

export interface ChargerPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "plug" | "monitor";
  demoAvailable?: boolean;
  directAdd?: boolean;
  ensureOnSelect?: boolean;
}
