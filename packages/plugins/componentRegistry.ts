import type { ComponentType } from "react";

/** Props passed to wizard step components by the wizard shell. */
export interface StepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onSkipTo: (step: number) => void;
  onSkipToEnd: () => void;
}

// Tesla wizard step components
import { KeyGenerationStep } from "./vehicles/tesla/client/KeyGenerationStep.tsx";
import { PartnerRegistrationStep } from "./vehicles/tesla/client/PartnerRegistrationStep.tsx";
import { PublicKeyHostingStep } from "./vehicles/tesla/client/PublicKeyHostingStep.tsx";
import { TeslaAuthStep } from "./vehicles/tesla/client/TeslaAuthStep.tsx";
import { TeslaCredentialsStep } from "./vehicles/tesla/client/TeslaCredentialsStep.tsx";
import { VehicleSelectionStep } from "./vehicles/tesla/client/VehicleSelectionStep.tsx";
import { VirtualKeyPairingStep } from "./vehicles/tesla/client/VirtualKeyPairingStep.tsx";

// Energy wizard step components (one per plugin)
import { FroniusLocalSetupStep } from "./energy/fronius-local/client/FroniusLocalSetupStep.tsx";
import { FroniusCloudSetupStep } from "./energy/fronius-cloud/client/FroniusCloudSetupStep.tsx";
import { SigenergyLocalSetupStep } from "./energy/sigenergy-local/client/SigenergyLocalSetupStep.tsx";
import { EnphaseLocalSetupStep } from "./energy/enphase-local/client/EnphaseLocalSetupStep.tsx";

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

// ── Plugin wizard step definitions ──────────────────────────────────────────

export interface PluginWizardStep {
  id: string;
  label: string;
  componentKey: string;
}

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
];

/** Schedule notes from vehicle plugins, shown on the Schedules page. */
export const vehicleScheduleNotes: PluginScheduleNote[] = [
  teslaScheduleNote,
];

/** Vehicle plugin wizard steps, keyed by VehicleAdapterType. */
export const vehiclePluginSteps: Record<string, PluginWizardStep[]> = {
  tesla: teslaWizardSteps,
  simulated: [],
};

/** Energy plugin wizard steps, keyed by energy adapter type. */
export const energyPluginSteps: Record<string, PluginWizardStep[]> = {
  fronius_local: froniusLocalWizardSteps,
  fronius_cloud: froniusCloudWizardSteps,
  sigenergy_local: sigenergyLocalWizardSteps,
  enphase_local: enphaseLocalWizardSteps,
  simulated_energy: simulatedEnergyWizardSteps,
};

/**
 * Maps componentKey strings (from PluginWizardStep) to React components.
 * Used by the wizard shell to render plugin-provided steps dynamically.
 */
export const pluginComponents: Record<string, ComponentType<StepProps>> = {
  "tesla-key-generation": KeyGenerationStep,
  "tesla-public-key-hosting": PublicKeyHostingStep,
  "tesla-credentials": TeslaCredentialsStep,
  "tesla-partner-registration": PartnerRegistrationStep,
  "tesla-auth": TeslaAuthStep,
  "tesla-vehicle-selection": VehicleSelectionStep,
  "tesla-virtual-key-pairing": VirtualKeyPairingStep,
  "fronius-local-setup": FroniusLocalSetupStep,
  "fronius-cloud-setup": FroniusCloudSetupStep,
  "sigenergy-local-setup": SigenergyLocalSetupStep,
  "enphase-local-setup": EnphaseLocalSetupStep,
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
};
