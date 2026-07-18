import { useCallback } from "react";
import { trpc } from "../trpc.ts";
import { useRouter } from "../hooks/useRouter.ts";
import { WizardShell } from "./Wizard/WizardShell.tsx";
import { wizardFlow } from "./Wizard/wizardFlow.ts";
import { useWizardState } from "../hooks/useWizardState.ts";

/**
 * Wizard routing component. Renders the setup wizard against the DB-backed
 * wizard state.
 */
export function WizardRouter({ onComplete }: { onComplete: () => void }) {
  const store = useWizardState();

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
      flow={wizardFlow}
      store={store}
      basePath="/wizard"
      onComplete={onComplete}
      onExit={wizardStatus?.completed ? handleExit : undefined}
    />
  );
}
