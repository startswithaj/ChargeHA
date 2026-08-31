import type { ComponentType } from "react";
import type { PluginStepDef } from "./hostUi.ts";
import type {
  ChargerPluginOption,
  EnergyPluginOption,
  PluginScheduleNote,
  PluginSettingsProps,
  VehiclePluginOption,
} from "./pluginOptions.ts";

export type {
  ChargerPluginOption,
  EnergyPluginOption,
  PluginScheduleNote,
  PluginSettingsProps,
  VehiclePluginOption,
};

import { SimulatedEnergyConfig } from "./energy/simulated/client/SimulatedEnergyConfig.tsx";
import { TeslaSettings } from "./vehicles/tesla/client/TeslaSettings.tsx";
import { SimulatedVehicleSettings } from "./vehicles/simulated/client/SimulatedVehicleSettings.tsx";
import { FroniusCloudConfig } from "./energy/fronius-cloud/client/FroniusCloudConfig.tsx";
import { FroniusLocalConfig } from "./energy/fronius-local/client/FroniusLocalConfig.tsx";
import { SigenergyLocalConfig } from "./energy/sigenergy-local/client/SigenergyLocalConfig.tsx";
import { EnphaseLocalConfig } from "./energy/enphase-local/client/EnphaseLocalConfig.tsx";
import { GoodweSemsConfig } from "./energy/goodwe-sems/client/GoodweSemsConfig.tsx";
import { TapoSettings } from "./chargers/tapo/client/TapoSettings.tsx";
import { OcppSettings } from "./chargers/ocpp/client/OcppSettings.tsx";
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
  goodweSemsOption,
  goodweSemsWizardSteps,
} from "./energy/goodwe-sems/client/wizardSteps.ts";
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

export const energyPluginOptions: EnergyPluginOption[] = [
  froniusLocalOption,
  froniusCloudOption,
  sigenergyLocalOption,
  enphaseLocalOption,
  goodweSemsOption,
  simulatedEnergyOption,
];

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

export const vehicleScheduleNotes: PluginScheduleNote[] = [
  teslaScheduleNote,
];

export const vehiclePluginSteps: Record<string, PluginStepDef[]> = {
  tesla: teslaWizardSteps,
  simulated: [],
};

export const energyPluginSteps: Record<string, PluginStepDef[]> = {
  fronius_local: froniusLocalWizardSteps,
  fronius_cloud: froniusCloudWizardSteps,
  sigenergy_local: sigenergyLocalWizardSteps,
  enphase_local: enphaseLocalWizardSteps,
  goodwe_sems: goodweSemsWizardSteps,
  simulated_energy: simulatedEnergyWizardSteps,
};

export const chargerPluginOptions: ChargerPluginOption[] = [
  tapoChargerOption,
  ocppChargerOption,
  simulatedChargerOption,
];

export const chargerPluginSteps: Record<string, PluginStepDef[]> = {
  tapo: tapoWizardSteps,
  ocpp: ocppWizardSteps,
  simulated_charger: simulatedChargerWizardSteps,
};

export const pluginSettingsComponents: Record<
  string,
  ComponentType<PluginSettingsProps>
> = {
  "tesla-settings": TeslaSettings,
  "simulated-settings": SimulatedVehicleSettings,
  "fronius-local-config": FroniusLocalConfig,
  "fronius-cloud-config": FroniusCloudConfig,
  "sigenergy-local-config": SigenergyLocalConfig,
  "enphase-local-config": EnphaseLocalConfig,
  "goodwe-sems-config": GoodweSemsConfig,
  "simulated-energy-config": SimulatedEnergyConfig,
  "tapo-settings": TapoSettings,
  "ocpp-settings": OcppSettings,
  "simulated_charger-settings": SimulatedChargerSettings,
};
