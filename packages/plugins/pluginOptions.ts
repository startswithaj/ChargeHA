/** Shapes a plugin uses to advertise itself to the host wizard.
 *
 *  These live apart from componentRegistry.ts because that module imports
 *  every plugin's wizardSteps to aggregate them — a plugin reading its own
 *  metadata shape from the aggregator would close a cycle. */

/** Metadata for an energy plugin option shown on the inverter type selection step. */
export interface EnergyPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "cloud" | "monitor";
  /** When true, this option is selectable in demo mode; others are disabled. */
  demoAvailable?: boolean;
}

/** Props every component in `pluginSettingsComponents` receives. Charger
 *  panels use `chargerId` to scope their config to one row — null in add
 *  mode (no row yet), undefined for panels outside the charger settings
 *  path. Lives here rather than `componentRegistry.ts` because that module
 *  imports every plugin's panel — a panel importing this type back out of it
 *  would close a cycle. */
export interface PluginSettingsProps {
  chargerId?: string | null;
}

/** A schedule-related note contributed by a vehicle plugin. */
export interface PluginScheduleNote {
  adapterType: string;
  text: string;
}

/** Metadata for a vehicle plugin option shown on the vehicle type selection step. */
export interface VehiclePluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "car" | "monitor";
  /** When true, this option is selectable in demo mode; others are disabled. */
  demoAvailable?: boolean;
  /** When true, selecting this option triggers the demo setup flow instead of plugin wizard steps. */
  demoSetup?: boolean;
  /** Default config for creating a new vehicle of this type from the settings page. */
  defaultVehicleConfig?: Record<string, unknown>;
}

/** Metadata for a charger plugin option on the charger type step.
 *  iconKey is a union like the vehicle/energy option types — "plug" for
 *  Tapo, "server" for OCPP, "monitor" for the simulated charger. */
export interface ChargerPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "plug" | "monitor";
  demoAvailable?: boolean;
  /** Needs no config — settings adds it with charger.create directly,
   *  never routing through the plugin setup flow. */
  directAdd?: boolean;
}
