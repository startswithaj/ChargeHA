import { useCallback, useEffect } from "react";
import { Button, Text } from "@radix-ui/themes";
import { X } from "lucide-react";
import { useRouter } from "../../hooks/useRouter.ts";
import { StepIndicator } from "./StepIndicator.tsx";
import { StepHost } from "./StepHost.tsx";
import {
  activeSteps,
  backTargetId,
  nextStepId,
  resolveStepIndex,
  skipTargetId,
  type StepDef,
  type StepProps,
  type WizardStore,
} from "./flow.ts";
import { type WizardAdvance, WizardAdvanceProvider } from "./wizardAdvance.ts";
import styles from "./WizardShell.module.css";

interface WizardShellProps {
  flow: StepDef[];
  store: WizardStore;
  /** Steps are addressed as `${basePath}/${stepId}`. */
  basePath: string;
  onComplete?: () => void;
  /** When set, an "Exit setup" button is shown that abandons the wizard —
   *  provided only when the wizard was previously completed. */
  onExit?: () => void;
  /** Called when Back is pressed on the first step. Without it, Back is
   *  disabled there. */
  onBackOut?: () => void;
}

function useWizardCallbacks(
  { flow, store, onComplete, onBackOut }: {
    flow: StepDef[];
    store: WizardStore;
    onComplete?: () => void;
    onBackOut?: () => void;
  },
) {
  const { state, patch } = store;

  const goToStep = useCallback(
    (id: string) => {
      const active = activeSteps(flow, state);
      if (!active.some((step) => step.id === id)) {
        // Every jump targets a step the caller believes is on screen. A miss
        // means the id is wrong, and landing "somewhere near it" is how the
        // old positional jumps went unnoticed.
        throw new Error(
          `Cannot jump to unknown or excluded wizard step "${id}".`,
        );
      }
      patch({ stepId: id });
    },
    [flow, state, patch],
  );

  const handleNext = useCallback(() => {
    const next = nextStepId(flow, state);
    if (next) patch({ stepId: next });
    else onComplete?.();
  }, [flow, state, patch, onComplete]);

  const handleBack = useCallback(() => {
    const target = backTargetId(flow, state);
    if (target) patch({ stepId: target });
    else onBackOut?.();
  }, [flow, state, patch, onBackOut]);

  const handleSkip = useCallback(() => {
    const target = skipTargetId(flow, state);
    // Nothing outside the block to land on — skipping part of a plugin's chain
    // abandons the run rather than continuing into steps that needed it.
    if (target) patch({ stepId: target });
    else onBackOut?.();
  }, [flow, state, patch, onBackOut]);

  const handleSkipToEnd = useCallback(() => {
    const last = activeSteps(flow, state).at(-1);
    if (last) patch({ stepId: last.id });
  }, [flow, state, patch]);

  // The selection and the step it leads to are written together: the next step
  // is read from the flow the new selection produces, so the id can never name
  // a step that selection hasn't put in the list.
  const advance = useCallback<WizardAdvance>(
    (selection) => {
      const nextState = { ...state, ...selection };
      patch({
        ...selection,
        stepId: nextStepId(flow, nextState) ?? nextState.stepId,
      });
    },
    [flow, state, patch],
  );

  return {
    goToStep,
    handleNext,
    handleBack,
    handleSkip,
    handleSkipToEnd,
    advance,
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

export function WizardShell(
  { flow, store, basePath, onComplete, onExit, onBackOut }: WizardShellProps,
) {
  const { replacePath } = useRouter();
  const active = activeSteps(flow, store.state);
  const currentStep = resolveStepIndex(flow, store.state);
  const stepConfig = active[currentStep];

  const {
    goToStep,
    handleNext,
    handleBack,
    handleSkip,
    handleSkipToEnd,
    advance,
  } = useWizardCallbacks({ flow, store, onComplete, onBackOut });

  // Keep the URL on the step actually being shown. The stored id can name a
  // step the current selections exclude; resolveStepIndex lands on a real one
  // and the URL follows what the user sees, not what the DB last recorded.
  const shownStepId = stepConfig?.id;
  useEffect(() => {
    if (shownStepId) replacePath(`${basePath}/${shownStepId}`);
  }, [shownStepId, basePath, replacePath]);

  if (store.isLoading) {
    return (
      <div className={styles.container}>
        <Text color="gray">Loading wizard...</Text>
      </div>
    );
  }

  if (active.length === 0 || !stepConfig) {
    return (
      <div className={styles.container}>
        <Text color="gray">No wizard steps configured.</Text>
      </div>
    );
  }

  const stepProps: StepProps = {
    onNext: handleNext,
    onBack: handleBack,
    onSkipTo: goToStep,
    onSkipToEnd: handleSkipToEnd,
  };

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === active.length - 1;

  return (
    <div className={styles.container}>
      {onExit && <ExitRow onExit={onExit} />}
      <StepIndicator
        total={active.length}
        current={currentStep}
        labels={active.map((s) => s.label)}
      />

      {/* Step header */}
      <div className={styles.stepHeader}>
        <Text size="1" color="gray">
          Step {currentStep + 1} of {active.length}
        </Text>
        <Text size="5" weight="bold">
          {stepConfig.label}
        </Text>
      </div>

      <WizardAdvanceProvider value={advance}>
        <StepHost
          key={stepConfig.id}
          def={stepConfig}
          stepProps={stepProps}
          nav={{
            isFirstStep,
            isLastStep,
            canBack: !isFirstStep || !!onBackOut,
            onBack: handleBack,
            onSkip: handleSkip,
          }}
          advance={handleNext}
        />
      </WizardAdvanceProvider>
    </div>
  );
}
