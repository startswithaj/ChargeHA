import { useEffect, useRef } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { AlertCircle, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "./trpc.ts";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { useWizardNextControl } from "../../../../client/src/components/Wizard/wizardNextControl.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

export function PartnerRegistrationStep(_props: StepProps): JSX.Element {
  const calledRef = useRef(false);

  const registerMutation = trpc.tesla.registerPartner.useMutation();

  // Register partner on mount. The Tesla partner_accounts API is idempotent,
  // so re-registering on every visit is safe and avoids the need to track
  // registration state in config.
  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;
    registerMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSuccess = registerMutation.isSuccess;
  const isError = registerMutation.isError;

  const errorMessage = registerMutation.error?.message;

  useWizardNextControl({
    canProceed: isSuccess,
    hint: isSuccess
      ? "Partner registered — Next continues"
      : "Partner registration must succeed to continue",
  });

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Registering your Tesla Developer App as a Fleet API partner. This allows
        ChargeHA to communicate with Tesla&apos;s servers on your behalf.
      </Text>

      {registerMutation.isPending && (
        <Callout.Root color="blue">
          <Callout.Icon>
            <Loader2 size={16} className={styles.spinner} />
          </Callout.Icon>
          <Callout.Text>Registering partner account...</Callout.Text>
        </Callout.Root>
      )}

      {isSuccess && (
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircle size={16} />
          </Callout.Icon>
          <Callout.Text>
            Partner registration successful! Your app is now registered with
            Tesla.
          </Callout.Text>
        </Callout.Root>
      )}

      {isError && (
        <>
          <Callout.Root color="red">
            <Callout.Icon>
              <AlertCircle size={16} />
            </Callout.Icon>
            <Callout.Text>{errorMessage}</Callout.Text>
          </Callout.Root>

          <div className={styles.stepActions}>
            <Button variant="soft" onClick={() => registerMutation.mutate()}>
              <RefreshCw size={16} />
              Retry
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
