import { useEffect, useState } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { CheckCircle, ExternalLink, Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import type { StepProps } from "../../../hostUi.ts";
import { hintUnlessLoading, useWizardNextControl } from "../../../hostUi.ts";
import { callbackUrl, resolveOAuthOrigin } from "./oauthOrigin.ts";
import { UnstableOriginCallout } from "./UnstableOriginCallout.tsx";
import { stepStyles as styles } from "../../../hostUi.ts";

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

function SuccessView() {
  return (
    <Callout.Root color="green">
      <Callout.Icon>
        <CheckCircle size={16} />
      </Callout.Icon>
      <Callout.Text>Tesla account authorized successfully!</Callout.Text>
    </Callout.Root>
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

export function TeslaAuthStep(_props: StepProps): JSX.Element {
  const [status, setStatus] = useState<Status>("idle");
  const tunnelStatus = trpc.plugin.vehicle.tesla.tunnelStatus.useQuery();
  const oauth = resolveOAuthOrigin(
    globalThis.location?.origin ?? "",
    tunnelStatus.data?.url,
  );
  const redirectUri = oauth.origin ? callbackUrl(oauth.origin) : null;

  const authorize = () => {
    if (oauth.origin) authUrlMutation.mutate({ origin: oauth.origin });
  };

  // Query auth status on mount (always enabled), poll during "polling" state
  const authStatusQuery = trpc.plugin.vehicle.tesla.teslaStatus.useQuery(
    undefined,
    {
      refetchInterval: status === "polling" ? 3000 : false,
    },
  );

  // If already authenticated on mount, skip straight to success
  useEffect(() => {
    if (authStatusQuery.data?.authenticated) {
      setStatus("success");
    }
  }, [authStatusQuery.data?.authenticated]);

  const authUrlMutation = trpc.plugin.vehicle.tesla.getAuthUrl.useMutation({
    onSuccess: ({ url }: { url: string }) => {
      globalThis.open(url, "_blank");
      setStatus("polling");
    },
    onError: () => setStatus("error"),
  });

  useWizardNextControl({
    canProceed: status === "success",
    hint: hintUnlessLoading(
      authStatusQuery.isLoading,
      status === "success"
        ? "Tesla account authorized — Next continues"
        : "Authorize with Tesla to continue",
    ),
  });

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Authorize ChargeHA to access your Tesla account. This will open a new
        window where you can log in to Tesla and grant access.
      </Text>

      {status === "idle" && redirectUri && oauth.origin && (
        <>
          <Text as="p" size="2" color="gray">
            Redirect URI that will be sent — it must be listed in your Tesla
            app's Allowed Redirect URI(s)
            {oauth.viaTunnel ? " and Allowed Returned URL(s)" : ""}:
          </Text>
          <div className={styles.copyRow}>
            <code className={styles.codeSnippet}>{redirectUri}</code>
          </div>
          <div className={styles.stepActions}>
            <Button size="3" onClick={authorize}>
              <ExternalLink size={16} />
              Authorize with Tesla
            </Button>
          </div>
        </>
      )}

      {status === "idle" && !oauth.origin && (
        <UnstableOriginCallout
          browserOrigin={globalThis.location?.origin ?? ""}
        />
      )}

      {status === "polling" && (
        <PollingView
          onCancel={() => {
            authUrlMutation.reset();
            setStatus("idle");
          }}
        />
      )}

      {status === "success" && <SuccessView />}

      {status === "error" && (
        <ErrorView
          errorMessage={authUrlMutation.error?.message ??
            "Failed to start authorization"}
          onRetry={() => {
            authUrlMutation.reset();
            authorize();
          }}
        />
      )}
    </div>
  );
}
