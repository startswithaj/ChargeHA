import { useEffect, useState } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { CheckCircle, ExternalLink, Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

type Status = "idle" | "polling" | "success" | "error";

function PollingView({ onCancel }: { onCancel: () => void }) {
  return (
    <>
      <Callout.Root color="blue">
        <Callout.Icon>
          <Loader2 size={16} className={styles.spinner} />
        </Callout.Icon>
        <Callout.Text>
          Complete the authorization in the Tesla window, then return here.
          Waiting for authentication...
        </Callout.Text>
      </Callout.Root>
      <div className={styles.stepActions}>
        <Button size="2" variant="soft" color="gray" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function SuccessView({ onNext }: { onNext: () => void }) {
  return (
    <>
      <Callout.Root color="green">
        <Callout.Icon>
          <CheckCircle size={16} />
        </Callout.Icon>
        <Callout.Text>Tesla account authorized successfully!</Callout.Text>
      </Callout.Root>
      <div className={styles.stepActions}>
        <Button onClick={onNext}>Continue</Button>
      </div>
    </>
  );
}

function ErrorView(
  { errorMessage, onRetry }: { errorMessage: string; onRetry: () => void },
) {
  return (
    <>
      <Callout.Root color="red">
        <Callout.Text>{errorMessage}</Callout.Text>
      </Callout.Root>
      <div className={styles.stepActions}>
        <Button size="3" onClick={onRetry}>
          <ExternalLink size={16} />
          Try Again
        </Button>
      </div>
    </>
  );
}

export function TeslaAuthStep({ onNext }: StepProps): JSX.Element {
  const [status, setStatus] = useState<Status>("idle");
  const tunnelStatus = trpc.wizard.tunnelStatus.useQuery();

  // Query auth status on mount (always enabled), poll during "polling" state
  const authStatusQuery = trpc.tesla.teslaStatus.useQuery(undefined, {
    refetchInterval: status === "polling" ? 3000 : false,
  });

  // If already authenticated on mount, skip straight to success
  useEffect(() => {
    if (authStatusQuery.data?.authenticated) {
      setStatus("success");
    }
  }, [authStatusQuery.data?.authenticated]);

  const authUrlMutation = trpc.tesla.getAuthUrl.useMutation({
    onSuccess: ({ url }: { url: string }) => {
      globalThis.open(url, "_blank");
      setStatus("polling");
    },
    onError: () => setStatus("error"),
  });

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Authorize ChargeHA to access your Tesla account. This will open a new
        window where you can log in to Tesla and grant access.
      </Text>

      {status === "idle" && (
        <div className={styles.stepActions}>
          <Button
            size="3"
            onClick={() =>
              authUrlMutation.mutate({
                origin: tunnelStatus.data?.url ?? globalThis.location.origin,
              })}
          >
            <ExternalLink size={16} />
            Authorize with Tesla
          </Button>
        </div>
      )}

      {status === "polling" && (
        <PollingView
          onCancel={() => {
            authUrlMutation.reset();
            setStatus("idle");
          }}
        />
      )}

      {status === "success" && <SuccessView onNext={onNext} />}

      {status === "error" && (
        <ErrorView
          errorMessage={authUrlMutation.error?.message ??
            "Failed to start authorization"}
          onRetry={() => {
            authUrlMutation.reset();
            authUrlMutation.mutate({
              origin: tunnelStatus.data?.url ??
                globalThis.location?.origin ?? "",
            });
          }}
        />
      )}
    </div>
  );
}
