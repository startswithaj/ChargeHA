import { createContext, useContext } from "react";
import type { WizardNavState } from "@chargeha/shared";

/**
 * Applies a selection and moves to whatever step it leads to.
 *
 * A selection can change which steps exist (picking Tesla adds Tesla's setup
 * steps; picking None removes an energy plugin's). The step after it is
 * therefore a fact about the flow under the *new* selection, which is why this
 * takes the change rather than a destination — steps never name their
 * successor, so nothing needs editing when the flow is reordered.
 */
export type WizardAdvance = (selection: Partial<WizardNavState>) => void;

const WizardAdvanceContext = createContext<WizardAdvance | null>(null);

/** The shell provides this so steps can commit a selection and move on. */
export const WizardAdvanceProvider = WizardAdvanceContext.Provider;

/**
 * Throws outside a shell: a selection step whose advance silently did nothing
 * would strand the user on a step they had already answered.
 */
export function useWizardAdvance(): WizardAdvance {
  const advance = useContext(WizardAdvanceContext);
  if (!advance) {
    throw new Error(
      "useWizardAdvance requires a WizardShell. A selection step rendered " +
        "without one cannot move the wizard forward.",
    );
  }
  return advance;
}
