import { StepHost } from "../../StepHost.tsx";
import type { StepDef, StepProps, WizardAdvance } from "../../flow.ts";

/**
 * Mounts one step the way the shell does — through the real StepHost, so the
 * step's Next button, its gate and its save are exercised together rather than
 * against a stand-in. Nav chrome is stubbed; everything else is production code.
 */
export function StepNextHarness(
  { def, onAdvance = () => {}, stepProps, isLastStep = false }: {
    def: StepDef;
    onAdvance?: WizardAdvance;
    stepProps?: Partial<StepProps>;
    isLastStep?: boolean;
  },
) {
  return (
    <StepHost
      def={def}
      stepProps={{
        onAdvance,
        onBack: () => {},
        onSkipTo: () => {},
        onSkipToEnd: () => {},
        ...stepProps,
      }}
      nav={{
        // Labelled "Cancel" so a step that renders its own Back button (key
        // import, for one) is not competing with the nav for the role.
        isFirstStep: true,
        isLastStep,
        canBack: true,
        onBack: () => {},
        onSkip: () => {},
      }}
      onAdvance={onAdvance}
    />
  );
}
