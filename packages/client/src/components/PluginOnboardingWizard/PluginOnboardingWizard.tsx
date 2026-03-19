import { useCallback, useEffect, useMemo } from "react";
import { Button, Text } from "@radix-ui/themes";
import { ArrowLeft, ArrowRight, SkipForward } from "lucide-react";
import { usePluginOnboardingState } from "../../hooks/usePluginOnboardingState.ts";
import { pluginComponents } from "@chargeha/plugins/componentRegistry";
import type { PluginWizardStep } from "@chargeha/plugins/componentRegistry";
import type { StepProps } from "../Wizard/WizardShell.tsx";
import { StepIndicator } from "../Wizard/StepIndicator.tsx";
import styles from "../Wizard/WizardShell.module.css";

interface PluginOnboardingWizardProps {
  pluginId: string;
  pluginName: string;
  steps: PluginWizardStep[];
  onComplete: () => void;
  onCancel: () => void;
}

function useStepCallbacks(
  { steps, currentStep, onboardingState, onComplete, onCancel }: {
    steps: PluginWizardStep[];
    currentStep: number;
    onboardingState: ReturnType<typeof usePluginOnboardingState>;
    onComplete: () => void;
    onCancel: () => void;
  },
) {
  const goToStep = useCallback(
    (step: number) => {
      if (steps.length === 0) return;
      const clamped = Math.max(0, Math.min(step, steps.length - 1));
      onboardingState.setStepId(steps[clamped].id);
    },
    [steps, onboardingState],
  );

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      goToStep(currentStep + 1);
    } else {
      onboardingState.clear();
      onComplete();
    }
  }, [currentStep, steps.length, goToStep, onboardingState, onComplete]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) goToStep(currentStep - 1);
    else onCancel();
  }, [currentStep, goToStep, onCancel]);

  const handleSkip = useCallback(() => {
    if (currentStep < steps.length - 1) goToStep(currentStep + 1);
  }, [currentStep, steps.length, goToStep]);

  const handleSkipToEnd = useCallback(() => {
    goToStep(steps.length - 1);
  }, [steps.length, goToStep]);

  return { goToStep, handleNext, handleBack, handleSkip, handleSkipToEnd };
}

function WizardNav(
  { isFirstStep, isLastStep, onBack, onSkip, onNext }: {
    isFirstStep: boolean;
    isLastStep: boolean;
    onBack: () => void;
    onSkip: () => void;
    onNext: () => void;
  },
) {
  return (
    <div className={styles.navigation}>
      <Button
        variant="soft"
        onClick={onBack}
        aria-label={isFirstStep ? "Cancel" : "Back"}
      >
        <ArrowLeft size={16} />
        {isFirstStep ? "Cancel" : "Back"}
      </Button>

      <div className={styles.navigationRight}>
        {!isLastStep && (
          <Button variant="ghost" onClick={onSkip} aria-label="Skip">
            Skip
            <SkipForward size={16} />
          </Button>
        )}

        <Button onClick={onNext} aria-label={isLastStep ? "Finish" : "Next"}>
          {isLastStep ? "Finish" : "Next"}
          {!isLastStep && <ArrowRight size={16} />}
        </Button>
      </div>
    </div>
  );
}

export function PluginOnboardingWizard({
  pluginId,
  pluginName: _pluginName,
  steps,
  onComplete,
  onCancel,
}: PluginOnboardingWizardProps) {
  const defaultStepId = steps.length > 0 ? steps[0].id : "";
  const onboardingState = usePluginOnboardingState(pluginId, defaultStepId);

  const currentStep = useMemo(() => {
    if (steps.length === 0) return 0;
    const idx = steps.findIndex((s) => s.id === onboardingState.stepId);
    return idx >= 0 ? idx : 0;
  }, [steps, onboardingState.stepId]);

  // Keep URL in sync with current step
  useEffect(() => {
    if (steps.length === 0) return;
    const stepId = steps[currentStep]?.id;
    if (stepId) {
      globalThis.history.replaceState(
        null,
        "",
        `/setup/${pluginId}/${stepId}`,
      );
    }
  }, [steps, currentStep, pluginId]);

  const { goToStep, handleNext, handleBack, handleSkip, handleSkipToEnd } =
    useStepCallbacks({
      steps,
      currentStep,
      onboardingState,
      onComplete,
      onCancel,
    });

  const stepProps: StepProps = {
    onNext: handleNext,
    onBack: handleBack,
    onSkip: handleSkip,
    onSkipTo: goToStep,
    onSkipToEnd: handleSkipToEnd,
  };

  if (steps.length === 0) return null;

  const stepDef = steps[currentStep];
  const StepComponent = stepDef
    ? pluginComponents[stepDef.componentKey]
    : undefined;
  const label = stepDef?.label ?? `Step ${currentStep + 1}`;
  const labels = steps.map((s) => s.label);
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className={styles.container}>
      <StepIndicator
        total={steps.length}
        current={currentStep}
        labels={labels}
      />

      {/* Step header */}
      <div className={styles.stepHeader}>
        <Text size="1" color="gray">
          Step {currentStep + 1} of {steps.length}
        </Text>
        <Text size="5" weight="bold">
          {label}
        </Text>
      </div>

      {/* Step content */}
      <div className={styles.stepContent}>
        {StepComponent
          ? <StepComponent {...stepProps} />
          : <Text color="gray">{label} — component not found</Text>}
      </div>

      <WizardNav
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        onBack={handleBack}
        onSkip={handleSkip}
        onNext={handleNext}
      />
    </div>
  );
}
