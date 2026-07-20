import { useEffect, useRef } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { AlertCircle, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "./trpc.ts";
import {
  advanceOnly,
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";

function partnerNext(isSuccess: boolean): WizardNext {
  if (!isSuccess) {
    return {
      kind: "blocked",
      reason: "Partner registration must succeed to continue",
    };
  }
  return {
    kind: "ready",
    hint: "Partner registered — Next continues",
    onNext: advanceOnly,
  };
}

export const partnerRegistrationStep: PluginStepDef = {
  id: "tesla-partner-registration",
  label: "Partner Registration",
  useStep: () => {
    const calledRef = useRef(false);
    const registerMutation = trpc.plugin.vehicle.tesla.registerPartner
      .useMutation();

    // Register on mount; Tesla's partner_accounts API is idempotent so there is no state to track.
    useEffect(() => {
      if (calledRef.current) return;
      calledRef.current = true;
      registerMutation.mutate();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
      next: partnerNext(registerMutation.isSuccess),
      view: (
        <PartnerRegistrationView
          isPending={registerMutation.isPending}
          isSuccess={registerMutation.isSuccess}
          errorMessage={registerMutation.error?.message ?? null}
          onRetry={() => registerMutation.mutate()}
        />
      ),
    };
  },
};

function PartnerRegistrationView(
  { isPending, isSuccess, errorMessage, onRetry }: {
    isPending: boolean;
    isSuccess: boolean;
    errorMessage: string | null;
    onRetry: () => void;
  },
) {
  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Registering your Tesla Developer App as a Fleet API partner. This allows
        ChargeHA to communicate with Tesla&apos;s servers on your behalf.
      </Text>

      {isPending && (
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

      {errorMessage && (
        <>
          <Callout.Root color="red">
            <Callout.Icon>
              <AlertCircle size={16} />
            </Callout.Icon>
            <Callout.Text>{errorMessage}</Callout.Text>
          </Callout.Root>

          <div className={styles.stepActions}>
            <Button variant="soft" onClick={onRetry}>
              <RefreshCw size={16} />
              Retry
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
