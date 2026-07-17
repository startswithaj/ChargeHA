import {
  energyPluginSteps,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import { welcomeStep } from "./steps/WelcomeStep.tsx";
import { timezoneStep } from "./steps/TimezoneStep.tsx";
import { vehicleTypeStep } from "./steps/VehicleTypeStep.tsx";
import { inverterTypeStep } from "./steps/InverterTypeStep.tsx";
import { authStep } from "./steps/AuthStep.tsx";
import { homeLocationStep } from "./steps/HomeLocationStep.tsx";
import { gridVoltageStep } from "./steps/GridVoltageStep.tsx";
import { doneStep } from "./steps/DoneStep.tsx";
import type { PluginStepDef, StepDef } from "./flow.ts";

/**
 * Stamp each plugin's steps with the plugin they belong to. The registry key
 * is the only place ownership is written down — a plugin author declares steps,
 * not when they apply.
 */
function ownedSteps(registry: Record<string, PluginStepDef[]>): StepDef[] {
  return Object.entries(registry).flatMap(([owner, steps]) =>
    steps.map((step) => ({ ...step, owner }))
  );
}

/**
 * The setup wizard, in order. Position here is the order the user sees; `owner`
 * decides presence. Adding, removing or reordering a step is an edit to this
 * array alone — no step names another, so nothing else has to change.
 */
export const wizardFlow: StepDef[] = [
  welcomeStep,
  authStep,
  timezoneStep,
  vehicleTypeStep,
  ...ownedSteps(vehiclePluginSteps),
  inverterTypeStep,
  ...ownedSteps(energyPluginSteps),
  homeLocationStep,
  gridVoltageStep,
  doneStep,
];
