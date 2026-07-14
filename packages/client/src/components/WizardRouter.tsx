import type React from "react";
import { useCallback, useMemo } from "react";
import { trpc } from "../trpc.ts";
import { useRouter } from "../hooks/useRouter.ts";
import { WizardShell, type WizardStepConfig } from "./Wizard/WizardShell.tsx";
import { WelcomeStep } from "./Wizard/steps/WelcomeStep.tsx";
import { TimezoneStep } from "./Wizard/steps/TimezoneStep.tsx";
import { VehicleTypeStep } from "./Wizard/steps/VehicleTypeStep.tsx";
import { InverterTypeStep } from "./Wizard/steps/InverterTypeStep.tsx";
import { AuthStep } from "./Wizard/steps/AuthStep.tsx";
import { HomeLocationStep } from "./Wizard/steps/HomeLocationStep.tsx";
import { GridVoltageStep } from "./Wizard/steps/GridVoltageStep.tsx";
import { DoneStep } from "./Wizard/steps/DoneStep.tsx";
import {
  energyPluginSteps,
  pluginComponents,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import { useWizardState } from "../hooks/useWizardState.ts";
import type { StepProps } from "./Wizard/WizardShell.tsx";

// ── Core wizard steps (always present) ──────────────────────────────────────

const CORE_STEPS_BEFORE: WizardStepConfig[] = [
  {
    id: "welcome",
    label: "Welcome",
    render: (props) => <WelcomeStep {...props} />,
  },
  {
    id: "authentication",
    label: "Authentication",
    render: (props) => <AuthStep {...props} />,
  },
  {
    id: "timezone",
    label: "Timezone",
    render: (props) => <TimezoneStep {...props} />,
  },
  {
    id: "vehicle-type",
    label: "Vehicle Type",
    render: (props) => <VehicleTypeStep {...props} />,
  },
];

const CORE_STEPS_MIDDLE: WizardStepConfig[] = [
  {
    id: "inverter-type",
    label: "Inverter Type",
    render: (props) => <InverterTypeStep {...props} />,
  },
];

const CORE_STEPS_AFTER: WizardStepConfig[] = [
  {
    id: "home-location",
    label: "Home Location",
    render: (props) => <HomeLocationStep {...props} />,
  },
  {
    id: "grid-voltage",
    label: "Grid Voltage",
    render: (props) => <GridVoltageStep {...props} />,
  },
  {
    id: "done",
    label: "Done",
    hideNext: true,
    render: (props) => <DoneStep {...props} />,
  },
];

/**
 * Render a plugin step component from a registry, or null if not registered.
 * Extracted as a pure helper so the registry-lookup branch is unit-testable
 * without mutating module-level state.
 */
export function renderPluginStep(
  componentKey: string,
  components: Record<string, React.ComponentType<StepProps>>,
  props: StepProps,
) {
  const Component = components[componentKey];
  return Component ? <Component {...props} /> : null;
}

/**
 * Compose wizard steps dynamically based on selected vehicle and energy types.
 * Core steps before + vehicle plugin steps + core steps middle + energy plugin steps + core steps after.
 */
export function composeWizardSteps(
  vehicleType: string,
  energyType: string,
): WizardStepConfig[] {
  const vehicleSteps = (vehiclePluginSteps[vehicleType] ?? []).map((step) => ({
    id: step.id,
    label: step.label,
    render: (props: StepProps) =>
      renderPluginStep(step.componentKey, pluginComponents, props),
  }));

  const energySteps = (energyPluginSteps[energyType] ?? []).map((step) => ({
    id: step.id,
    label: step.label,
    render: (props: StepProps) =>
      renderPluginStep(step.componentKey, pluginComponents, props),
  }));

  return [
    ...CORE_STEPS_BEFORE,
    ...vehicleSteps,
    ...CORE_STEPS_MIDDLE,
    ...energySteps,
    ...CORE_STEPS_AFTER,
  ];
}

/**
 * Wizard routing component. Composes wizard steps dynamically based on
 * vehicle/energy selection and renders WizardShell.
 */
export function WizardRouter({ onComplete }: { onComplete: () => void }) {
  const wizardState = useWizardState();
  const wizardSteps = useMemo(
    () => composeWizardSteps(wizardState.vehicleType, wizardState.energyType),
    [wizardState.vehicleType, wizardState.energyType],
  );

  // A re-opened wizard (already completed once) can be exited early; on first
  // run there is no configured app to fall back to, so no exit is offered.
  const { navigate } = useRouter();
  const { data: wizardStatus } = trpc.wizard.status.useQuery();
  const handleExit = useCallback(
    () => navigate({ type: "app", page: "settings" }),
    [navigate],
  );

  return (
    <WizardShell
      steps={wizardSteps}
      onComplete={onComplete}
      onExit={wizardStatus?.completed ? handleExit : undefined}
    />
  );
}
