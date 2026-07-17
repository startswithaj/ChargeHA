import type { PluginStepDef } from "../../../hostUi.ts";
import type {
  PluginScheduleNote,
  VehiclePluginOption,
} from "../../../componentRegistry.ts";
import { keyGenerationStep } from "./KeyGenerationStep.tsx";
import { publicKeyHostingStep } from "./PublicKeyHostingStep.tsx";
import { teslaCredentialsStep } from "./TeslaCredentialsStep.tsx";
import { partnerRegistrationStep } from "./PartnerRegistrationStep.tsx";
import { teslaAuthStep } from "./TeslaAuthStep.tsx";
import { vehicleSelectionStep } from "./VehicleSelectionStep.tsx";
import { virtualKeyPairingStep } from "./VirtualKeyPairingStep.tsx";

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

/** Tesla wizard steps, in the order they are walked. */
export const teslaWizardSteps: PluginStepDef[] = [
  keyGenerationStep,
  publicKeyHostingStep,
  teslaCredentialsStep,
  partnerRegistrationStep,
  teslaAuthStep,
  vehicleSelectionStep,
  virtualKeyPairingStep,
];
