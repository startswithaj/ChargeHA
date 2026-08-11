// Shapes a plugin uses to advertise itself to the host wizard. Lives apart
// from componentRegistry.ts because that module imports every plugin's
// wizardSteps to aggregate them — reading this shape from there would close a cycle.

export interface EnergyPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "cloud" | "monitor";
  // When true, this option is selectable in demo mode; others are disabled.
  demoAvailable?: boolean;
}

// Props every component in `pluginSettingsComponents` receives. `chargerId`
// scopes a charger panel to one row — null in add mode, undefined outside the
// charger settings path. Lives here to avoid the same import cycle as above.
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
  // When true, this option is selectable in demo mode; others are disabled.
  demoAvailable?: boolean;
  // When true, selecting this option triggers the demo setup flow instead of plugin wizard steps.
  demoSetup?: boolean;
  defaultVehicleConfig?: Record<string, unknown>;
}

// Metadata for a charger plugin option on the charger type step. iconKey is a
// union like the vehicle/energy option types — "plug" for Tapo, "server" for
// OCPP, "monitor" for the simulated charger.
export interface ChargerPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "plug" | "monitor";
  demoAvailable?: boolean;
  // Needs no config — settings adds it with charger.create directly,
  // never routing through the plugin setup flow.
  directAdd?: boolean;
  // The wizard creates the row (charger.ensure) the moment this type is
  // selected — for types with no setup step of their own.
  ensureOnSelect?: boolean;
  // Storage key in a row's `chargerConfig` holding the charge point's own id.
  // Lets a host name which physical charger a row is without naming any
  // plugin's config key. Absent when the adapter has no such id.
  identityConfigKey?: string;
}
