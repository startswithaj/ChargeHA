import { useState } from "react";
import { Button, Callout, Select, Text, TextField } from "@radix-ui/themes";
import { Check, CheckCircle, Copy, ExternalLink } from "lucide-react";
import { useTeslaConfig, useTeslaConfigMutation } from "./useTeslaConfig.ts";
import { trpc } from "./trpc.ts";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

const REGIONS = [
  { value: "na", label: "NA (North America / Asia-Pacific)" },
  { value: "eu", label: "EU (Europe / Middle East / Africa)" },
  { value: "cn", label: "CN (China)" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts (HTTP on LAN)
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button size="1" variant="ghost" onClick={handleCopy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function CredentialInputs(
  { clientId, setClientId, clientSecret, setClientSecret, region, setRegion }: {
    clientId: string;
    setClientId: (v: string) => void;
    clientSecret: string;
    setClientSecret: (v: string) => void;
    region: string;
    setRegion: (v: string) => void;
  },
) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Client ID</Text>
        <TextField.Root
          placeholder="e.g., f689df54-d25a-487b-9217-ba25fd4f0d3f"
          value={clientId}
          onChange={(e: { target: { value: string } }) =>
            setClientId(e.target.value)}
          aria-label="Client ID"
        />
      </div>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Client Secret</Text>
        <TextField.Root
          placeholder="ta-secret...."
          value={clientSecret}
          onChange={(e: { target: { value: string } }) =>
            setClientSecret(e.target.value)}
          aria-label="Client Secret"
        />
      </div>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Region</Text>
        <Select.Root value={region} onValueChange={setRegion}>
          <Select.Trigger aria-label="Region" />
          <Select.Content>
            {REGIONS.map((r) => (
              <Select.Item key={r.value} value={r.value}>
                {r.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Text as="p" size="1" color="gray">
          Select the region where your vehicle is registered. Australia is NA.
        </Text>
      </div>
    </>
  );
}

function DeveloperPortalInstructions(
  { currentOrigin, redirectUri }: {
    currentOrigin: string;
    redirectUri: string;
  },
) {
  return (
    <div className={styles.instructionBox}>
      <Text as="p" size="2" weight="medium">
        How to get your credentials:
      </Text>
      <ol className={styles.instructionList}>
        <li>
          <Text as="span" size="2">
            Go to{" "}
            <a
              href="https://developer.tesla.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              developer.tesla.com
              <ExternalLink
                size={12}
                style={{ marginLeft: 4, verticalAlign: "middle" }}
              />
            </a>{" "}
            and sign in with your Tesla account
          </Text>
        </li>
        <li>
          <Text as="span" size="2">
            Click <strong>Create Application</strong>
          </Text>
        </li>
        <li>
          <Text as="span" size="2">
            App Name: whatever you like (e.g., "ChargeHA")
          </Text>
        </li>
        <li>
          <Text as="span" size="2">
            OAuth Grant Type:{" "}
            <strong>Authorization Code and Machine-to-Machine</strong>
          </Text>
        </li>
        <li>
          <Text as="span" size="2">
            Scopes: <strong>Vehicle Information</strong>,{" "}
            <strong>Vehicle Location</strong>,{" "}
            <strong>Vehicle Charging Management</strong>
          </Text>
        </li>
      </ol>
      <Text as="p" size="2" weight="medium" style={{ marginTop: "0.75rem" }}>
        Allowed Origin URLs:
      </Text>
      <div className={styles.copyRow}>
        <code className={styles.codeSnippet}>{currentOrigin}</code>
        <CopyButton text={currentOrigin} />
      </div>
      <Text as="p" size="2" weight="medium" style={{ marginTop: "0.5rem" }}>
        Allowed Redirect URIs:
      </Text>
      <div className={styles.copyRow}>
        <code className={styles.codeSnippet}>{redirectUri}</code>
        <CopyButton text={redirectUri} />
      </div>
      <Text as="p" size="1" color="gray" style={{ marginTop: "0.5rem" }}>
        After updating these values on the Tesla Developer Portal, wait 2-3
        minutes for changes to propagate before continuing.
      </Text>
    </div>
  );
}

export function TeslaCredentialsStep({ onNext }: StepProps): JSX.Element {
  const { data: teslaConfig } = useTeslaConfig();
  const [clientId, setClientId] = useState(
    teslaConfig?.teslaClientId || "",
  );
  const [clientSecret, setClientSecret] = useState(
    teslaConfig?.teslaClientSecret || "",
  );
  const [region, setRegion] = useState(teslaConfig?.teslaRegion || "na");

  const isValid = clientId.trim().length > 0 && clientSecret.trim().length > 0;

  // Build the domain from the current window location for instructions
  const browserOrigin = typeof globalThis !== "undefined"
    ? globalThis.location.origin
    : "http://localhost:8000";

  // Check if tunnel is active (started on the Public Key Hosting step)
  const tunnelStatus = trpc.wizard.tunnelStatus.useQuery();
  const tunnelUrl = tunnelStatus.data?.url;

  // Use tunnel URL when active, otherwise use browser origin
  const currentOrigin = tunnelUrl ?? browserOrigin;
  const redirectUri = `${currentOrigin}/api/vehicle/tesla/callback`;

  const saveMutation = useTeslaConfigMutation();

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Enter your Tesla Fleet API credentials. You'll need to create an
        application on the Tesla Developer Portal first.
      </Text>

      {tunnelUrl && (
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircle size={16} />
          </Callout.Icon>
          <Callout.Text>
            Cloudflare Tunnel is active. The URLs below use your tunnel address.
          </Callout.Text>
        </Callout.Root>
      )}

      <DeveloperPortalInstructions
        currentOrigin={currentOrigin}
        redirectUri={redirectUri}
      />

      <CredentialInputs
        clientId={clientId}
        setClientId={setClientId}
        clientSecret={clientSecret}
        setClientSecret={setClientSecret}
        region={region}
        setRegion={setRegion}
      />

      <div className={styles.stepActions}>
        <Button
          onClick={() =>
            saveMutation.mutate(
              {
                teslaClientId: clientId.trim(),
                teslaClientSecret: clientSecret.trim(),
                teslaRegion: region as "na" | "eu" | "cn",
              },
              { onSuccess: () => onNext() },
            )}
          disabled={!isValid || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : "Save & Continue"}
        </Button>
      </div>

      {saveMutation.error && (
        <Text as="p" size="2" color="red">
          {saveMutation.error.message}
        </Text>
      )}
    </div>
  );
}
