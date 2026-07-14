import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Text } from "@radix-ui/themes";
import { ArrowLeft, ArrowRight, SkipForward, X } from "lucide-react";
import { useWizardState } from "../../hooks/useWizardState.ts";
import { useRouter } from "../../hooks/useRouter.ts";
import { StepIndicator } from "./StepIndicator.tsx";
import {
  type WizardNextControl,
  WizardNextProvider,
} from "./wizardNextControl.ts";
import styles from "./WizardShell.module.css";
import type { ReactNode } from "react";

export interface StepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onSkipTo: (step: number) => void;
  onSkipToEnd: () => void;
}

export interface WizardStepConfig {
  /** Unique string identifier for this step (persisted to the database). */
  id: string;
  label: string;
  /** Hide the Next/Finish button (Back stays) — e.g. the Done step completes via its own CTA. */
  hideNext?: boolean;
  render: (props: StepProps) => ReactNode;
}

interface WizardShellProps {
  steps?: WizardStepConfig[];
  onComplete?: () => void;
  /** When set, an "Exit setup" button is shown that abandons the wizard —
   *  provided only when the wizard was previously completed. */
  onExit?: () => void;
}

function useWizardCallbacks(
  { steps, currentStep, wizardState, onComplete }: {
    steps: WizardStepConfig[] | undefined;
    currentStep: number;
    wizardState: ReturnType<typeof useWizardState>;
    onComplete?: () => void;
  },
) {
  const goToStep = useCallback(
    (step: number) => {
      if (!steps || steps.length === 0) return;
      const clamped = Math.max(0, Math.min(step, steps.length - 1));
      wizardState.setStepId(steps[clamped].id);
    },
    [steps, wizardState],
  );

  const handleNext = useCallback(() => {
    if (!steps) return;
    if (currentStep < steps.length - 1) goToStep(currentStep + 1);
    else if (onComplete) onComplete();
  }, [currentStep, steps, goToStep, onComplete]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) goToStep(currentStep - 1);
  }, [currentStep, goToStep]);

  const handleSkip = useCallback(() => {
    if (!steps) return;
    if (currentStep < steps.length - 1) goToStep(currentStep + 1);
  }, [currentStep, steps, goToStep]);

  const handleSkipToEnd = useCallback(() => {
    if (!steps) return;
    goToStep(steps.length - 1);
  }, [steps, goToStep]);

  return { goToStep, handleNext, handleBack, handleSkip, handleSkipToEnd };
}

function WizardNav(
  {
    isFirstStep,
    isLastStep,
    hideNext,
    onBack,
    onSkip,
    onNext,
    nextDisabled,
    nextBlocked,
    busyLabel,
    hint,
  }: {
    isFirstStep: boolean;
    isLastStep: boolean;
    hideNext: boolean;
    onBack: () => void;
    onSkip: () => void;
    onNext: () => void;
    nextDisabled: boolean;
    nextBlocked: boolean;
    busyLabel: string | null;
    hint: string | null;
  },
) {
  return (
    <div className={styles.navigation}>
      <Button
        variant="soft"
        onClick={onBack}
        disabled={isFirstStep}
        aria-label="Back"
      >
        <ArrowLeft size={16} />
        Back
      </Button>
      <div className={styles.navigationRight}>
        {hint && (
          <Text
            size="2"
            color={nextBlocked ? "orange" : "gray"}
            weight="medium"
          >
            {hint}
          </Text>
        )}
        {!isLastStep && (
          <Button variant="ghost" onClick={onSkip} aria-label="Skip">
            Skip
            <SkipForward size={16} />
          </Button>
        )}
        {!hideNext && (
          <Button
            onClick={onNext}
            disabled={nextDisabled}
            aria-label={isLastStep ? "Finish" : "Next"}
          >
            {busyLabel ?? (isLastStep ? "Finish" : "Next")}
            {!busyLabel && !isLastStep && <ArrowRight size={16} />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Holds the active step's Next-button control and runs its onBeforeNext
 *  when Next is clicked, advancing only when the handler resolves true. */
function useNextControlState(advance: () => void) {
  const [control, setControl] = useState<WizardNextControl | null>(null);
  const [pending, setPending] = useState(false);

  const handleNextClick = useCallback(async () => {
    if (!control?.onBeforeNext) {
      advance();
      return;
    }
    setPending(true);
    try {
      if (await control.onBeforeNext()) advance();
    } finally {
      setPending(false);
    }
  }, [control, advance]);

  return {
    setControl,
    handleNextClick,
    disabled: pending || (control ? !control.canProceed : false),
    // Blocked (missing input) is highlighted; merely busy is not.
    blocked: control ? !control.canProceed : false,
    busyLabel: pending ? control?.pendingLabel ?? "Working..." : null,
    hint: control?.hint ?? null,
  };
}

function ExitRow({ onExit }: { onExit: () => void }) {
  return (
    <div className={styles.exitRow}>
      <Button
        variant="ghost"
        color="gray"
        onClick={onExit}
        aria-label="Exit setup"
      >
        <X size={16} />
        Exit setup
      </Button>
    </div>
  );
}

/** Resolve the current step index from the DB-persisted step ID, syncing the
 *  DB and URL when the stored ID is invalid or belongs to a removed step. */
function useResolvedStep(
  steps: WizardStepConfig[] | undefined,
  wizardState: ReturnType<typeof useWizardState>,
) {
  const { replacePath } = useRouter();

  // If step ID is not found (plugin steps removed or invalid ID), fall back to 0.
  // Normal selection changes are handled by VehicleTypeStep/InverterTypeStep
  // which navigate directly to the correct step ID after changing selections.
  const currentStep = useMemo(() => {
    if (!steps || steps.length === 0) return 0;
    const idx = steps.findIndex((s) => s.id === wizardState.stepId);
    if (idx >= 0) return idx;
    // Clamp: try step after vehicle-type (covers removed plugin steps)
    const vehicleIdx = steps.findIndex((s) => s.id === "vehicle-type");
    if (vehicleIdx >= 0 && vehicleIdx + 1 < steps.length) {
      return vehicleIdx + 1;
    }
    return 0;
  }, [steps, wizardState.stepId]);

  // Sync DB stepId when the resolved index doesn't match the stored ID
  // (happens after clamping due to plugin step removal or invalid stored ID)
  useEffect(() => {
    if (!steps || steps.length === 0) return;
    const resolved = steps[currentStep];
    if (resolved && resolved.id !== wizardState.stepId) {
      wizardState.setStepId(resolved.id);
    }
  }, [steps, currentStep, wizardState]);

  // Keep URL in sync with current step
  useEffect(() => {
    if (!steps || steps.length === 0) return;
    const stepId = steps[currentStep]?.id;
    if (stepId) replacePath(`/wizard/${stepId}`);
  }, [steps, currentStep, replacePath]);

  return currentStep;
}

export function WizardShell({ steps, onComplete, onExit }: WizardShellProps) {
  const wizardState = useWizardState();
  const stepsTotal = steps?.length ?? 0;

  const currentStep = useResolvedStep(steps, wizardState);

  const { goToStep, handleNext, handleBack, handleSkip, handleSkipToEnd } =
    useWizardCallbacks({ steps, currentStep, wizardState, onComplete });

  const nextControl = useNextControlState(handleNext);

  const stepProps: StepProps = {
    onNext: handleNext,
    onBack: handleBack,
    onSkip: handleSkip,
    onSkipTo: goToStep,
    onSkipToEnd: handleSkipToEnd,
  };

  if (wizardState.isLoading) {
    return (
      <div className={styles.container}>
        <Text color="gray">Loading wizard...</Text>
      </div>
    );
  }

  if (!steps || steps.length === 0) {
    return (
      <div className={styles.container}>
        <Text color="gray">No wizard steps configured.</Text>
      </div>
    );
  }

  const stepConfig = steps[currentStep];
  const label = stepConfig?.label ?? `Step ${currentStep + 1}`;
  const labels = steps.map((s) => s.label);
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === stepsTotal - 1;

  return (
    <div className={styles.container}>
      {onExit && <ExitRow onExit={onExit} />}
      <StepIndicator
        total={stepsTotal}
        current={currentStep}
        labels={labels}
      />

      {/* Step header */}
      <div className={styles.stepHeader}>
        <Text size="1" color="gray">
          Step {currentStep + 1} of {stepsTotal}
        </Text>
        <Text size="5" weight="bold">
          {label}
        </Text>
      </div>

      {/* Step content */}
      <div className={styles.stepContent}>
        <WizardNextProvider value={nextControl.setControl}>
          {stepConfig
            ? stepConfig.render(stepProps)
            : <Text color="gray">{label} — not yet implemented</Text>}
        </WizardNextProvider>
      </div>

      <WizardNav
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        hideNext={!!stepConfig?.hideNext}
        onBack={handleBack}
        onSkip={handleSkip}
        onNext={nextControl.handleNextClick}
        nextDisabled={nextControl.disabled}
        nextBlocked={nextControl.blocked}
        busyLabel={nextControl.busyLabel}
        hint={nextControl.hint}
      />
    </div>
  );
}
