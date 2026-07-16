import { createContext, useContext, useEffect, useRef } from "react";

/**
 * Gating + behaviour a step attaches to the wizard shell's Next button.
 * Steps that need work done before advancing (saving a form, validating a
 * connection) register one of these instead of rendering their own
 * Continue/Save & Continue button.
 */
export interface WizardNextControl {
  /** Next is disabled while false. */
  canProceed: boolean;
  /** Shown beside the nav — why Next is disabled, or what Next will do,
   *  e.g. "Test the connection to continue" / "Next saves your timezone". */
  hint?: string;
  /** Shown on the Next button while onBeforeNext runs, e.g. "Saving...". */
  pendingLabel?: string;
  /** Runs when Next is clicked; resolve true to advance, false to stay
   *  (after surfacing an error inline in the step). */
  onBeforeNext?: () => Promise<boolean>;
}

/** Suppress the nav hint while a step's backing query is still loading — a
 *  blocked-hint that flips to ready milliseconds after mount reads as an
 *  orange flash in the nav. Next stays disabled via canProceed meanwhile. */
export function hintUnlessLoading(
  loading: boolean,
  hint: string,
): string | undefined {
  return loading ? undefined : hint;
}

const WizardNextContext = createContext<
  ((control: WizardNextControl | null) => void) | null
>(null);

/** WizardShell provides this so the active step can drive the Next button. */
export const WizardNextProvider = WizardNextContext.Provider;

/** Steps call this to gate/extend the shell's Next button. The control is
 *  cleared automatically when the step unmounts. */
export function useWizardNextControl(control: WizardNextControl): void {
  const report = useContext(WizardNextContext);
  const { canProceed, hint, pendingLabel, onBeforeNext } = control;

  // Keep the latest onBeforeNext in a ref and report a stable wrapper. Steps
  // routinely recreate onBeforeNext each render (it closes over form state and
  // react-query mutation objects); depending on its identity in the effect
  // below would re-report every render and spin the shell into an infinite
  // update loop. The wrapper always calls the newest handler, so callers never
  // have to memoize it. Only presence (defined vs not) affects the reported
  // control, so re-report on that boolean, not the function identity.
  const onBeforeNextRef = useRef(onBeforeNext);
  useEffect(() => {
    onBeforeNextRef.current = onBeforeNext;
  });
  const hasBeforeNext = !!onBeforeNext;

  useEffect(() => {
    report?.({
      canProceed,
      hint,
      pendingLabel,
      onBeforeNext: hasBeforeNext
        ? () => onBeforeNextRef.current?.() ?? Promise.resolve(false)
        : undefined,
    });
  }, [report, canProceed, hint, pendingLabel, hasBeforeNext]);
  useEffect(() => () => report?.(null), [report]);
}
