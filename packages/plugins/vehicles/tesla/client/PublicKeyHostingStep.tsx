import { useEffect, useRef, useState } from "react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { CheckCircle, Globe, Loader2 } from "lucide-react";
import { useTeslaConfig, useTeslaConfigMutation } from "./useTeslaConfig.ts";
import { trpc } from "./trpc.ts";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
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
  { tunnelUrl, onNext }: { tunnelUrl: string; onNext: () => void },
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
          <strong>{tunnelUrl}/{WELL_KNOWN_PATH}</strong>. This domain is saved
          automatically — no additional hosting setup needed.
        </Callout.Text>
      </Callout.Root>
      <div className={styles.stepActions}>
        <Button onClick={onNext}>Continue</Button>
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
    saveDomainMutation.mutate({ teslaPublicKeyDomain: browserOrigin });
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
  { hostingMethod, setHostingMethod, publicKey, startTunnelMutation }: {
    hostingMethod: HostingMethod;
    setHostingMethod: (m: HostingMethod) => void;
    publicKey: string;
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

export function PublicKeyHostingStep({ onNext }: StepProps): JSX.Element {
  const { data: teslaConfig } = useTeslaConfig();
  const browserOrigin = globalThis.location?.origin || "";
  const publicKey = teslaConfig?.ecPublicKeyPem || "";

  const tunnelStatus = trpc.wizard.tunnelStatus.useQuery();
  const tunnelActive = tunnelStatus.data?.active ?? false;
  const tunnelUrl = tunnelStatus.data?.url;

  const startTunnelMutation = trpc.wizard.startTunnel.useMutation({
    onSuccess: () => tunnelStatus.refetch(),
  });

  const [choice, setChoice] = useState<HostingChoice>(null);
  const [hostingMethod, setHostingMethod] = useState<HostingMethod>(null);

  // "Yes" flow uses the browser origin (server is internet-accessible)
  const publicKeyUrl = `${browserOrigin}/${WELL_KNOWN_PATH}`;

  const saveDomainMutation = useTeslaConfigMutation();

  // Keep the persisted public-key domain in sync with the live tunnel URL.
  // The Cloudflare tunnel URL is ephemeral — a new one is minted every time the
  // tunnel starts (e.g. restarting the wizard) — while partner registration
  // reads tesla.public_key_domain from the DB. Without this, the DB keeps a
  // stale tunnel URL and Tesla rejects it with "domain not registered".
  const savedDomain = teslaConfig?.teslaPublicKeyDomain;
  const lastSavedTunnelUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!tunnelActive || !tunnelUrl) return;
    if (tunnelUrl === savedDomain) return; // already persisted
    if (tunnelUrl === lastSavedTunnelUrl.current) return; // saved, awaiting refetch
    lastSavedTunnelUrl.current = tunnelUrl;
    saveDomainMutation.mutate({ teslaPublicKeyDomain: tunnelUrl });
  }, [tunnelActive, tunnelUrl, savedDomain, saveDomainMutation.mutate]);

  if (tunnelActive && tunnelUrl) {
    return <TunnelActiveView tunnelUrl={tunnelUrl} onNext={onNext} />;
  }

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Tesla needs to fetch your public key from an internet-accessible URL
        during the pairing process. It only needs to be reachable during setup.
      </Text>

      {teslaConfig?.teslaPublicKeyDomain && (
        <>
          <Callout.Root color="green">
            <Callout.Icon>
              <CheckCircle size={16} />
            </Callout.Icon>
            <Callout.Text>
              Public key domain is already configured as{" "}
              <strong>{teslaConfig.teslaPublicKeyDomain}</strong>.
            </Callout.Text>
          </Callout.Root>

          <div className={styles.stepActions}>
            <Button onClick={onNext}>Continue</Button>
          </div>
        </>
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
          setHostingMethod={setHostingMethod}
          publicKey={publicKey}
          startTunnelMutation={startTunnelMutation}
        />
      )}
    </div>
  );
}
