import { useEffect, useState } from "react";
import { Button, Text } from "@radix-ui/themes";
import { ArrowLeft, ArrowRight, SkipForward } from "lucide-react";
import type { StepDef, StepProps, WizardAdvance, WizardNext } from "./flow.ts";
import styles from "./WizardShell.module.css";

/** The label shown on Next while its handler runs. Every step that did any
 *  work on Next used "Saving..." — it was never worth a per-step field. */
const PENDING_LABEL = "Saving...";

export interface StepNav {
  isFirstStep: boolean;
  isLastStep: boolean;
  /** False disables Back — the first step with nowhere to back out to. */
  canBack: boolean;
  onBack: () => void;
  onSkip: () => void;
}

interface StepHostProps {
  def: StepDef;
  stepProps: StepProps;
  nav: StepNav;
  /** Applies the selection the step returned (if any) and moves on. */
  onAdvance: WizardAdvance;
}

/** The reason text shown beside the nav: why Next is disabled, what it will
 *  do, or why the last attempt didn't go through. */
function hintFor(next: WizardNext): string | null {
  if (next.kind === "blocked") return next.reason;
  if (next.kind === "ready") return next.hint;
  return null;
}

/** The Next button reads "Finish" on the last step — same action, and the
 *  aria-label has to agree with it. */
function advanceLabel(isLastStep: boolean): string {
  return isLastStep ? "Finish" : "Next";
}

function WizardNav(
  { nav, next, pending, hint, onNext }: {
    nav: StepNav;
    next: WizardNext;
    pending: boolean;
    hint: string | null;
    onNext: () => void;
  },
) {
  return (
    <div className={styles.navFooter}>
      {hint && (
        <div className={styles.navHintRow}>
          <Text size="2" color="gray" weight="medium">
            {hint}
          </Text>
        </div>
      )}
      <div className={styles.navigation}>
        <Button
          variant="soft"
          onClick={nav.onBack}
          disabled={!nav.canBack}
          aria-label={nav.isFirstStep ? "Cancel" : "Back"}
        >
          <ArrowLeft size={16} />
          {nav.isFirstStep ? "Cancel" : "Back"}
        </Button>
        <div className={styles.navigationRight}>
          {!nav.isLastStep && (
            <Button variant="ghost" onClick={nav.onSkip} aria-label="Skip">
              Skip
              <SkipForward size={16} />
            </Button>
          )}
          {next.kind !== "hidden" && (
            <Button
              onClick={onNext}
              disabled={next.kind !== "ready" || pending}
              aria-label={advanceLabel(nav.isLastStep)}
            >
              {pending ? PENDING_LABEL : advanceLabel(nav.isLastStep)}
              {!pending && !nav.isLastStep && <ArrowRight size={16} />}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders one step and the Next button that belongs to it.
 *
 * The step's state, its gate and its save all live here, in the same call —
 * `useStep` is the only way to get the step's view, so a step can never be
 * rendered while its Next behaviour is dropped on the floor.
 *
 * Must be given `key={def.id}` by the caller: a different step is a different
 * `useStep` with different hooks inside, so the host has to remount rather
 * than change hook order mid-render.
 */
export function StepHost({ def, stepProps, nav, onAdvance }: StepHostProps) {
  const { next, view } = def.useStep(stepProps);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Why the last attempt failed stops being true the moment the step's own
  // gate moves — a different mode picked, a field fixed. Keeping it would
  // leave a stale reason next to a button that would now succeed.
  const gateText = hintFor(next);
  useEffect(() => {
    setFailure(null);
  }, [next.kind, gateText]);

  const handleNext = async () => {
    if (next.kind !== "ready") return;
    setPending(true);
    setFailure(null);
    try {
      // One move, not two: the step reports its selection and the shell applies
      // it together with the step id. When the step moved itself and the shell
      // moved again, the second recomputed the destination from state that
      // predated the selection and silently overwrote the first.
      const selection = await next.onNext();
      onAdvance(selection ?? undefined);
    } catch (err) {
      // The step said stay, and said why. Show it beside the button that
      // failed rather than leaving each step to render its own error.
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  // A Fragment, not a wrapper element: .stepContent has to stay a direct flex
  // child of .container, or its flex:1 stops pushing the nav to the bottom of
  // the viewport and the footer rides up under the content.
  return (
    <>
      <div className={styles.stepContent}>{view}</div>
      <WizardNav
        nav={nav}
        next={next}
        pending={pending}
        hint={failure ?? hintFor(next)}
        onNext={handleNext}
      />
    </>
  );
}
