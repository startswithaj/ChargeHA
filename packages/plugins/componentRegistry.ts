import type { ComponentType } from "react";
import type { PluginStepDef } from "./hostUi.ts";

// Simulated energy settings component
import { SimulatedEnergyConfig } from "./energy/simulated/client/SimulatedEnergyConfig.tsx";

// Tesla settings component
import { TeslaSettings } from "./vehicles/tesla/client/TeslaSettings.tsx";

// Simulated vehicle settings component
import {
  SimulatedDataOnlySettings,
  SimulatedVehicleSettings,
} from "./vehicles/simulated/client/SimulatedVehicleSettings.tsx";

// Fronius settings components
import { FroniusCloudConfig } from "./energy/fronius-cloud/client/FroniusCloudConfig.tsx";
import { FroniusLocalConfig } from "./energy/fronius-local/client/FroniusLocalConfig.tsx";

// Sigenergy settings component
import { SigenergyLocalConfig } from "./energy/sigenergy-local/client/SigenergyLocalConfig.tsx";

// Enphase settings component
import { EnphaseLocalConfig } from "./energy/enphase-local/client/EnphaseLocalConfig.tsx";

// Tapo settings component
import { TapoSettings } from "./chargers/tapo/client/TapoSettings.tsx";

// OCPP settings component
import { OcppSettings } from "./chargers/ocpp/client/OcppSettings.tsx";

// Simulated charger settings component
import { SimulatedChargerSettings } from "./chargers/simulated/client/SimulatedChargerSettings.tsx";

// Plugin wizard step definitions — imported from each plugin's client folder
import {
  froniusCloudOption,
  froniusCloudWizardSteps,
} from "./energy/fronius-cloud/client/wizardSteps.ts";
import {
  froniusLocalOption,
  froniusLocalWizardSteps,
} from "./energy/fronius-local/client/wizardSteps.ts";
import {
  sigenergyLocalOption,
  sigenergyLocalWizardSteps,
} from "./energy/sigenergy-local/client/wizardSteps.ts";
import {
  enphaseLocalOption,
  enphaseLocalWizardSteps,
} from "./energy/enphase-local/client/wizardSteps.ts";
import {
  simulatedEnergyOption,
  simulatedEnergyWizardSteps,
} from "./energy/simulated/client/wizardSteps.ts";
import {
  teslaScheduleNote,
  teslaVehicleOption,
  teslaWizardSteps,
} from "./vehicles/tesla/client/wizardSteps.ts";
import {
  tapoChargerOption,
  tapoWizardSteps,
} from "./chargers/tapo/client/wizardSteps.ts";
import {
  ocppChargerOption,
  ocppWizardSteps,
} from "./chargers/ocpp/client/wizardSteps.ts";
import {
  simulatedChargerOption,
  simulatedChargerWizardSteps,
} from "./chargers/simulated/client/wizardSteps.ts";

/** Metadata for an energy plugin option shown on the inverter type selection step. */
export interface EnergyPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "cloud" | "monitor";
  /** When true, this option is selectable in demo mode; others are disabled. */
  demoAvailable?: boolean;
}

/** Energy plugin options for the inverter type selection step. */
export const energyPluginOptions: EnergyPluginOption[] = [
  froniusLocalOption,
  froniusCloudOption,
  sigenergyLocalOption,
  enphaseLocalOption,
  simulatedEnergyOption,
];

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

/** Vehicle plugin options for the vehicle type selection step. */
export const vehiclePluginOptions: VehiclePluginOption[] = [
  teslaVehicleOption,
  {
    id: "simulated",
    label: "Simulated",
    description:
      "Creates a virtual vehicle for testing. You can add a real vehicle later in Settings.",
    iconKey: "monitor",
    demoSetup: true,
    demoAvailable: true,
    defaultVehicleConfig: {
      batteryCapacityKwh: 75,
      initialSocPercent: 50,
      chargeLimitPercent: 80,
    },
  },
  {
    id: "simulated_dataonly",
    label: "Simulated (data only)",
    description:
      "A virtual vehicle with no charging API — pair it with a smart " +
      "charger to test charger-controlled setups.",
    iconKey: "monitor",
    demoSetup: true,
    demoAvailable: true,
    defaultVehicleConfig: {
      batteryCapacityKwh: 75,
      initialSocPercent: 50,
      chargeLimitPercent: 80,
    },
  },
];

/** Schedule notes from vehicle plugins, shown on the Schedules page. */
export const vehicleScheduleNotes: PluginScheduleNote[] = [
  teslaScheduleNote,
];

/** Vehicle plugin wizard steps, keyed by VehicleAdapterType. */
export const vehiclePluginSteps: Record<string, PluginStepDef[]> = {
  tesla: teslaWizardSteps,
  simulated: [],
};

/** Energy plugin wizard steps, keyed by energy adapter type. */
export const energyPluginSteps: Record<string, PluginStepDef[]> = {
  fronius_local: froniusLocalWizardSteps,
  fronius_cloud: froniusCloudWizardSteps,
  sigenergy_local: sigenergyLocalWizardSteps,
  enphase_local: enphaseLocalWizardSteps,
  simulated_energy: simulatedEnergyWizardSteps,
};

/** Metadata for a charger plugin option on the charger type step.
 *  iconKey is a union like the vehicle/energy option types — "plug" for
 *  Tapo, "server" for OCPP, "monitor" for the simulated charger. */
export interface ChargerPluginOption {
  id: string;
  label: string;
  description: string;
  iconKey: "server" | "plug" | "monitor";
  demoAvailable?: boolean;
  /** Needs no config — settings adds it with charger.ensure directly,
   *  never routing through the plugin setup flow. */
  directAdd?: boolean;
}

/** Charger plugin options for the charger type selection step. Filled by
 *  plugin change sets (tapoChargerOption, ocppChargerOption,
 *  simulatedChargerOption). */
export const chargerPluginOptions: ChargerPluginOption[] = [
  tapoChargerOption,
  ocppChargerOption,
  simulatedChargerOption,
];

/** Charger plugin wizard steps, keyed by charger adapter type. Filled by
 *  plugin change sets (tapo: tapoWizardSteps, ocpp: ocppWizardSteps,
 *  simulated_charger: simulatedChargerWizardSteps). */
export const chargerPluginSteps: Record<string, PluginStepDef[]> = {
  tapo: tapoWizardSteps,
  ocpp: ocppWizardSteps,
  simulated_charger: simulatedChargerWizardSteps,
};

/**
 * Maps settingsComponentKey strings (from EnergyPlugin) to React components.
 * Used by the settings page to render plugin-provided config forms dynamically.
 */
export const pluginSettingsComponents: Record<string, ComponentType> = {
  "tesla-settings": TeslaSettings,
  "simulated-settings": SimulatedVehicleSettings,
  "simulated-dataonly-settings": SimulatedDataOnlySettings,
  "fronius-local-config": FroniusLocalConfig,
  "fronius-cloud-config": FroniusCloudConfig,
  "sigenergy-local-config": SigenergyLocalConfig,
  "enphase-local-config": EnphaseLocalConfig,
  "simulated-energy-config": SimulatedEnergyConfig,
  "tapo-settings": TapoSettings,
  "ocpp-settings": OcppSettings,
  "simulated_charger-settings": SimulatedChargerSettings,
};
