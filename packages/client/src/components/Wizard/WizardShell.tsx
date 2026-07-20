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
  type WizardAdvance,
  type WizardStore,
} from "./flow.ts";
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
        // A missed id means the caller is wrong; landing near it would hide that.
        throw new Error(
          `Cannot jump to unknown or excluded wizard step "${id}".`,
        );
      }
      patch({ stepId: id });
    },
    [flow, state, patch],
  );

  const handleBack = useCallback(() => {
    const target = backTargetId(flow, state);
    if (target) patch({ stepId: target });
    else onBackOut?.();
  }, [flow, state, patch, onBackOut]);

  const handleSkip = useCallback(() => {
    const target = skipTargetId(flow, state);
    // Skipping part of a plugin's chain abandons the whole run.
    if (target) patch({ stepId: target });
    else onBackOut?.();
  }, [flow, state, patch, onBackOut]);

  const handleSkipToEnd = useCallback(() => {
    const last = activeSteps(flow, state).at(-1);
    if (last) patch({ stepId: last.id });
  }, [flow, state, patch]);

  // The only way forward: the selection and the step it leads to are written together.
  const advance = useCallback<WizardAdvance>(
    (selection = {}) => {
      const nextState = { ...state, ...selection };
      const next = nextStepId(flow, nextState);
      if (next) {
        patch({ ...selection, stepId: next });
        return;
      }
      if (Object.keys(selection).length > 0) patch(selection);
      onComplete?.();
    },
    [flow, state, patch, onComplete],
  );

  return {
    goToStep,
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
    handleBack,
    handleSkip,
    handleSkipToEnd,
    advance,
  } = useWizardCallbacks({ flow, store, onComplete, onBackOut });

  // Keep the URL on the step actually rendered, which may differ from the stored id.
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
    onAdvance: advance,
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
        onAdvance={advance}
      />
    </div>
  );
}
