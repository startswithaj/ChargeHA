import type { ComponentType } from "react";
import type { PluginStepDef } from "./hostUi.ts";
import type {
  ChargerPluginOption,
  EnergyPluginOption,
  PluginScheduleNote,
  VehiclePluginOption,
} from "./pluginOptions.ts";

export type {
  ChargerPluginOption,
  EnergyPluginOption,
  PluginScheduleNote,
  VehiclePluginOption,
};

// Simulated energy settings component
import { SimulatedEnergyConfig } from "./energy/simulated/client/SimulatedEnergyConfig.tsx";

// Tesla settings component
import { TeslaSettings } from "./vehicles/tesla/client/TeslaSettings.tsx";

// Simulated vehicle settings component
import { SimulatedVehicleSettings } from "./vehicles/simulated/client/SimulatedVehicleSettings.tsx";

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

/** Energy plugin options for the inverter type selection step. */
export const energyPluginOptions: EnergyPluginOption[] = [
  froniusLocalOption,
  froniusCloudOption,
  sigenergyLocalOption,
  enphaseLocalOption,
  simulatedEnergyOption,
];

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
  "fronius-local-config": FroniusLocalConfig,
  "fronius-cloud-config": FroniusCloudConfig,
  "sigenergy-local-config": SigenergyLocalConfig,
  "enphase-local-config": EnphaseLocalConfig,
  "simulated-energy-config": SimulatedEnergyConfig,
  "tapo-settings": TapoSettings,
  "ocpp-settings": OcppSettings,
  "simulated_charger-settings": SimulatedChargerSettings,
};
