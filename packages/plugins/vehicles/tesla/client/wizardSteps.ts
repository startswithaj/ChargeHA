import type {
  PluginScheduleNote,
  PluginWizardStep,
  VehiclePluginOption,
} from "../../../componentRegistry.ts";

/** Tesla schedule note shown on the Schedules page. */
export const teslaScheduleNote: PluginScheduleNote = {
  adapterType: "tesla",
  text:
    "If you have a schedule that triggers when your Tesla is likely in deep sleep (e.g. overnight), set a matching Scheduled Departure or charge start time in the Tesla app. The API can sometimes fail to wake the vehicle from deep sleep.",
};

/** Tesla option metadata for the vehicle type selection step. */
export const teslaVehicleOption: VehiclePluginOption = {
  id: "tesla",
  label: "Tesla",
  description:
    "Connects to the Tesla Fleet API for real vehicle control. You'll need a Tesla developer account.",
  iconKey: "car",
};

/** Tesla wizard step definitions for the setup wizard. */
export const teslaWizardSteps: PluginWizardStep[] = [
  {
    id: "tesla-key-generation",
    label: "Key Generation",
    componentKey: "tesla-key-generation",
  },
  {
    id: "tesla-public-key-hosting",
    label: "Public Key Hosting",
    componentKey: "tesla-public-key-hosting",
  },
  {
    id: "tesla-credentials",
    label: "Tesla Credentials",
    componentKey: "tesla-credentials",
  },
  {
    id: "tesla-partner-registration",
    label: "Partner Registration",
    componentKey: "tesla-partner-registration",
  },
  {
    id: "tesla-auth",
    label: "Tesla Authorization",
    componentKey: "tesla-auth",
  },
  {
    id: "tesla-vehicle-selection",
    label: "Vehicle Selection",
    componentKey: "tesla-vehicle-selection",
  },
  {
    id: "tesla-virtual-key-pairing",
    label: "Virtual Key Pairing",
    componentKey: "tesla-virtual-key-pairing",
  },
];
