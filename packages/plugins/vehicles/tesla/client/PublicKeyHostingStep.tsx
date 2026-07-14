import { useState } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { CheckCircle, Globe, Loader2 } from "lucide-react";
import { useTeslaConfig, useTeslaConfigMutation } from "./useTeslaConfig.ts";
import { trpc } from "./trpc.ts";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import {
  hintUnlessLoading,
  useWizardNextControl,
} from "../../../../client/src/components/Wizard/wizardNextControl.ts";
import { canTeslaFetchKeyFrom, isStableOrigin } from "./oauthOrigin.ts";
import {
  AiPromptInstructions,
  GitHubPagesInstructions,
  SelfHostInstructions,
  WELL_KNOWN_PATH,
} from "./PublicKeyHostingParts.tsx";
import { DomainVerifyForm } from "./DomainVerifyForm.tsx";
import {
  type HostingMethod,
  HostingMethodCards,
} from "./HostingMethodCards.tsx";
import { DirectHostingSection } from "./DirectHostingSection.tsx";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

type HostingChoice = null | "yes" | "no";

function TunnelActiveView(
  { tunnelUrl, onStop, stopping }: {
    tunnelUrl: string;
    onStop: () => void;
    stopping: boolean;
  },
) {
  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Tesla needs to fetch your public key from an internet-accessible URL
        during the pairing process. It only needs to be reachable during setup.
      </Text>
      <Callout.Root color="green">
        <Callout.Icon>
          <CheckCircle size={16} />
        </Callout.Icon>
        <Callout.Text>
          Your public key is being served via the Cloudflare Tunnel at{" "}
          <strong>{tunnelUrl}/{WELL_KNOWN_PATH}</strong>. The domain has already
          been saved — no additional hosting setup needed.
        </Callout.Text>
      </Callout.Root>
      <div className={styles.stepActions}>
        <Button variant="soft" onClick={onStop} disabled={stopping}>
          {stopping
            ? <Loader2 size={14} className={styles.spinner} />
            : <Globe size={14} />}
          {stopping
            ? "Stopping tunnel..."
            : "Stop tunnel & choose another method"}
        </Button>
      </div>
    </div>
  );
}

function ChoiceCards(
  { choice, setChoice, browserOrigin, saveDomainMutation, setHostingMethod }: {
    choice: HostingChoice;
    setChoice: (c: HostingChoice) => void;
    browserOrigin: string;
    saveDomainMutation: ReturnType<typeof useTeslaConfigMutation>;
    setHostingMethod: (m: HostingMethod) => void;
  },
) {
  const selectYes = () => {
    setChoice("yes");
    saveDomainMutation.mutate({
      teslaPublicKeyDomain: browserOrigin,
      teslaPublicKeyHosting: "custom",
    });
  };
  const selectNo = () => {
    setChoice("no");
    setHostingMethod(null);
  };
  return (
    <div className={styles.optionCards}>
      <div
        className={`${styles.optionCard} ${
          choice === "yes" ? styles.optionCardSelected : ""
        }`}
        onClick={selectYes}
        role="button"
        tabIndex={0}
        aria-label="Yes, internet accessible"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") selectYes();
        }}
      >
        <Text size="3" weight="medium">
          Yes — ChargeHA is internet-accessible
        </Text>
        <Text size="2" color="gray">
          Tesla can fetch the key directly from your server.
        </Text>
      </div>
      <div
        className={`${styles.optionCard} ${
          choice === "no" ? styles.optionCardSelected : ""
        }`}
        onClick={selectNo}
        role="button"
        tabIndex={0}
        aria-label="No, not internet accessible"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") selectNo();
        }}
      >
        <Text size="3" weight="medium">
          No — ChargeHA runs on my local network only
        </Text>
        <Text size="2" color="gray">
          You'll need to host the key somewhere publicly accessible.
        </Text>
      </div>
    </div>
  );
}

function TunnelHostingSection(
  { startTunnelMutation }: {
    startTunnelMutation: ReturnType<typeof trpc.wizard.startTunnel.useMutation>;
  },
) {
  return (
    <div className={styles.instructionBox}>
      <Text as="p" size="2" color="gray">
        Start a temporary Cloudflare Tunnel to serve your public key. No account
        required — the tunnel is torn down when the wizard completes.
      </Text>
      <div style={{ marginTop: "0.75rem" }}>
        <Button
          size="2"
          onClick={() => startTunnelMutation.mutate()}
          disabled={startTunnelMutation.isPending}
        >
          {startTunnelMutation.isPending
            ? <Loader2 size={14} className={styles.spinner} />
            : <Globe size={14} />}
          {startTunnelMutation.isPending
            ? "Starting Tunnel..."
            : "Start Tunnel"}
        </Button>
      </div>
      {startTunnelMutation.error && (
        <Text as="p" size="2" color="red" style={{ marginTop: "0.5rem" }}>
          {startTunnelMutation.error.message}
        </Text>
      )}
    </div>
  );
}

function HostingMethodSection(
  {
    hostingMethod,
    setHostingMethod,
    publicKey,
    staticDisabled,
    startTunnelMutation,
  }: {
    hostingMethod: HostingMethod;
    setHostingMethod: (m: HostingMethod) => void;
    publicKey: string;
    staticDisabled: boolean;
    startTunnelMutation: ReturnType<typeof trpc.wizard.startTunnel.useMutation>;
  },
) {
  return (
    <>
      <Text as="p" size="2" weight="medium">
        How would you like to host your public key?
      </Text>
      <HostingMethodCards
        hostingMethod={hostingMethod}
        onSelect={setHostingMethod}
        staticDisabled={staticDisabled}
      />
      {hostingMethod === "self" && (
        <>
          <SelfHostInstructions publicKey={publicKey} />
          <DomainVerifyForm
            publicKey={publicKey}
            wellKnownPath={WELL_KNOWN_PATH}
          />
        </>
      )}
      {hostingMethod === "github" && (
        <>
          <GitHubPagesInstructions publicKey={publicKey} />
          <DomainVerifyForm
            publicKey={publicKey}
            wellKnownPath={WELL_KNOWN_PATH}
          />
        </>
      )}
      {hostingMethod === "ai" && (
        <>
          <AiPromptInstructions publicKey={publicKey} />
          <DomainVerifyForm
            publicKey={publicKey}
            wellKnownPath={WELL_KNOWN_PATH}
          />
        </>
      )}
      {hostingMethod === "tunnel" && (
        <TunnelHostingSection startTunnelMutation={startTunnelMutation} />
      )}
    </>
  );
}

function useTunnelMutations() {
  // deno-lint-ignore custom-main-refs/no-main-trpc -- TODO(plugin-api): tunnel endpoints move behind the plugin API
  const tunnelStatus = trpc.wizard.tunnelStatus.useQuery();
  const onTunnelChanged = () => {
    tunnelStatus.refetch();
  };
  return {
    tunnelStatus,
    // deno-lint-ignore custom-main-refs/no-main-trpc -- TODO(plugin-api): tunnel endpoints move behind the plugin API
    startTunnelMutation: trpc.wizard.startTunnel.useMutation({
      onSuccess: onTunnelChanged,
    }),
    // deno-lint-ignore custom-main-refs/no-main-trpc -- TODO(plugin-api): tunnel endpoints move behind the plugin API
    stopTunnelMutation: trpc.wizard.stopTunnel.useMutation({
      onSuccess: onTunnelChanged,
    }),
  };
}

function hostingHint(configured: boolean, tunnelChosen: boolean): string {
  if (configured) return "Public key hosting is configured — Next continues";
  if (tunnelChosen) return "Start the tunnel to continue";
  return "Configure public key hosting to continue";
}

/** A completed Tesla setup (authenticated + key paired) doesn't need the
 *  tunnel anymore — it was only required during registration and pairing. */
function useTeslaWorking(): boolean {
  const status = trpc.plugin.vehicle.tesla.teslaStatus.useQuery();
  return status.data?.authenticated === true &&
    status.data?.keyPaired === true;
}

function CustomConfiguredCallout({ domain }: { domain: string }) {
  return (
    <Callout.Root color="green">
      <Callout.Icon>
        <CheckCircle size={16} />
      </Callout.Icon>
      <Callout.Text>
        Public key domain is already configured as <strong>{domain}</strong>.
      </Callout.Text>
    </Callout.Root>
  );
}

function TunnelTornDownCallout() {
  return (
    <Callout.Root color="green">
      <Callout.Icon>
        <CheckCircle size={16} />
      </Callout.Icon>
      <Callout.Text>
        Tesla is set up and working — the tunnel was torn down after pairing and
        is only needed again if you re-pair (which also requires re-running
        partner registration with the new tunnel URL).
      </Callout.Text>
    </Callout.Root>
  );
}

function UnreachableOriginCallout(
  { browserOrigin }: { browserOrigin: string },
) {
  return (
    <Callout.Root color="amber">
      <Callout.Text>
        You're accessing ChargeHA at <strong>{browserOrigin}</strong>{" "}
        — Tesla's servers likely can't fetch the key from this address, so "No"
        with a hosting method (the Cloudflare Tunnel is the quickest) is the
        usual choice here.
      </Callout.Text>
    </Callout.Root>
  );
}

export function PublicKeyHostingStep(_props: StepProps): JSX.Element {
  const { data: teslaConfig } = useTeslaConfig();
  const browserOrigin = globalThis.location?.origin || "";
  const publicKey = teslaConfig?.ecPublicKeyPem || "";

  const { tunnelStatus, startTunnelMutation, stopTunnelMutation } =
    useTunnelMutations();
  const tunnelActive = tunnelStatus.data?.active ?? false;
  const tunnelUrl = tunnelStatus.data?.url;

  const [choice, setChoice] = useState<HostingChoice>(null);
  const [hostingMethod, setHostingMethod] = useState<HostingMethod>(null);

  // "Yes" flow uses the browser origin (server is internet-accessible)
  const publicKeyUrl = `${browserOrigin}/${WELL_KNOWN_PATH}`;

  const saveDomainMutation = useTeslaConfigMutation();

  // Persist the hosting choice — it's the only durable bit; the tunnel URL
  // itself is live state and never stored.
  const selectMethod = (method: HostingMethod) => {
    setHostingMethod(method);
    if (method === "tunnel") {
      saveDomainMutation.mutate({ teslaPublicKeyHosting: "tunnel" });
    }
  };

  const tunnelRunning = tunnelActive && !!tunnelUrl;
  const hosting = teslaConfig?.teslaPublicKeyHosting ?? "";
  // In tunnel mode only a live tunnel counts — but a completed Tesla setup
  // no longer needs one (it was torn down on purpose after pairing).
  const teslaWorking = useTeslaWorking();
  const customConfigured = hosting === "custom" &&
    !!teslaConfig?.teslaPublicKeyDomain;
  const tunnelChosen = (choice === "no" && hostingMethod === "tunnel") ||
    (choice === null && hosting === "tunnel");
  const domainConfigured = tunnelChosen
    ? tunnelRunning || teslaWorking
    : tunnelRunning || customConfigured;
  useWizardNextControl({
    canProceed: domainConfigured,
    hint: hintUnlessLoading(
      teslaConfig === undefined || tunnelStatus.isLoading,
      hostingHint(domainConfigured, tunnelChosen),
    ),
  });

  if (tunnelActive && tunnelUrl) {
    return (
      <TunnelActiveView
        tunnelUrl={tunnelUrl}
        onStop={() => stopTunnelMutation.mutate()}
        stopping={stopTunnelMutation.isPending}
      />
    );
  }

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Tesla needs to fetch your public key from an internet-accessible URL
        during the pairing process. It only needs to be reachable during setup.
      </Text>

      {customConfigured && (
        <CustomConfiguredCallout
          domain={teslaConfig?.teslaPublicKeyDomain ?? ""}
        />
      )}

      {hosting === "tunnel" && !tunnelRunning && teslaWorking && (
        <TunnelTornDownCallout />
      )}

      {!canTeslaFetchKeyFrom(browserOrigin) && (
        <UnreachableOriginCallout browserOrigin={browserOrigin} />
      )}

      <ChoiceCards
        choice={choice}
        setChoice={setChoice}
        browserOrigin={browserOrigin}
        saveDomainMutation={saveDomainMutation}
        setHostingMethod={setHostingMethod}
      />

      {/* Internet-accessible: show URL and reminder */}
      {choice === "yes" && (
        <DirectHostingSection
          publicKeyUrl={publicKeyUrl}
          publicKey={publicKey}
        />
      )}

      {choice === "no" && (
        <HostingMethodSection
          hostingMethod={hostingMethod}
          setHostingMethod={selectMethod}
          publicKey={publicKey}
          staticDisabled={!isStableOrigin(browserOrigin)}
          startTunnelMutation={startTunnelMutation}
        />
      )}
    </div>
  );
}
