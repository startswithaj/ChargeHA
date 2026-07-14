import { useState } from "react";
import type { ReactNode } from "react";
import {
  type WizardNextControl,
  WizardNextProvider,
} from "../../wizardNextControl.ts";

/**
 * Minimal stand-in for WizardShell's nav in step tests: exposes the step's
 * registered Next control as a real "Next" button (plus its hint text) so
 * tests can drive save-then-advance behaviour without mounting the shell.
 */
export function StepNextHarness(
  { children, onAdvance }: { children: ReactNode; onAdvance: () => void },
) {
  const [control, setControl] = useState<WizardNextControl | null>(null);
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    if (!control?.onBeforeNext) {
      onAdvance();
      return;
    }
    setPending(true);
    try {
      if (await control.onBeforeNext()) onAdvance();
    } finally {
      setPending(false);
    }
  };

  const busyLabel = pending ? control?.pendingLabel ?? "Working..." : null;

  return (
    <WizardNextProvider value={setControl}>
      {children}
      <button
        type="button"
        disabled={pending || (control ? !control.canProceed : false)}
        onClick={handleClick}
      >
        {busyLabel ?? "Next"}
      </button>
      {control?.hint && <span>{control.hint}</span>}
    </WizardNextProvider>
  );
}
