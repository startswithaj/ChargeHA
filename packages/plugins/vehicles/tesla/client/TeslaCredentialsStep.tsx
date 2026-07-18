import { useCallback, useState } from "react";
import { Button, Callout, Select, Text, TextField } from "@radix-ui/themes";
import { Check, CheckCircle, Copy, ExternalLink } from "lucide-react";
import { useTeslaConfig, useTeslaConfigMutation } from "./useTeslaConfig.ts";
import { trpc } from "./trpc.ts";
import { type PluginStepDef, type WizardNext } from "../../../hostUi.ts";
import { callbackUrl, resolveOAuthOrigin } from "./oauthOrigin.ts";
import { resolvePublicKeyDomain } from "../shared/publicKeyDomain.ts";
import { UnstableOriginCallout } from "./UnstableOriginCallout.tsx";
import { stepStyles as styles } from "../../../hostUi.ts";

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
          placeholder="e.g., 12ab34cd-56ef-78ab-90cd-12ef34ab56cd"
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
  { allowedOrigin, redirectUri, viaTunnel }: {
    allowedOrigin: string;
    redirectUri: string;
    viaTunnel: boolean;
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
      {allowedOrigin && (
        <>
          <Text
            as="p"
            size="2"
            weight="medium"
            style={{ marginTop: "0.75rem" }}
          >
            Allowed Origin URL(s):
          </Text>
          <div className={styles.copyRow}>
            <code className={styles.codeSnippet}>{allowedOrigin}</code>
            <CopyButton text={allowedOrigin} />
          </div>
        </>
      )}
      <Text as="p" size="2" weight="medium" style={{ marginTop: "0.5rem" }}>
        Allowed Redirect URI(s):
      </Text>
      <div className={styles.copyRow}>
        <code className={styles.codeSnippet}>{redirectUri}</code>
        <CopyButton text={redirectUri} />
      </div>
      {viaTunnel && (
        <>
          <Text as="p" size="2" weight="medium" style={{ marginTop: "0.5rem" }}>
            Allowed Returned URL(s):
          </Text>
          <div className={styles.copyRow}>
            <code className={styles.codeSnippet}>{redirectUri}</code>
            <CopyButton text={redirectUri} />
          </div>
          <Text as="p" size="1" color="gray" style={{ marginTop: "0.25rem" }}>
            Tesla requires the callback in both Redirect URIs and Returned URLs
            when using a tunnel domain.
          </Text>
        </>
      )}
      <Text as="p" size="1" color="gray" style={{ marginTop: "0.5rem" }}>
        After updating these values on the Tesla Developer Portal, wait 2-3
        minutes for changes to propagate before continuing.
      </Text>
    </div>
  );
}

function OriginCallouts(
  { viaTunnel, origin, browserOrigin }: {
    viaTunnel: boolean;
    origin: string | null;
    browserOrigin: string;
  },
) {
  if (viaTunnel && origin) {
    return (
      <Callout.Root color="green">
        <Callout.Icon>
          <CheckCircle size={16} />
        </Callout.Icon>
        <Callout.Text>
          The tunnel is active. Your address isn't registrable with Tesla (plain
          http), so the OAuth URLs below use the tunnel — they must be
          re-registered whenever the tunnel restarts.
        </Callout.Text>
      </Callout.Root>
    );
  }
  if (!origin) {
    return <UnstableOriginCallout browserOrigin={browserOrigin} />;
  }
  return null;
}

function AlreadyWorkingCallout() {
  return (
    <Callout.Root color="amber">
      <Callout.Text>
        Tesla is already connected and working. Continuing will require a new
        tunnel session and updating your Tesla developer portal (Allowed Origin,
        Redirect URIs, Returned URLs). Use Skip to keep the current setup — only
        continue if you're re-pairing or changing credentials.
      </Callout.Text>
    </Callout.Root>
  );
}

/** A working setup means re-running these steps invalidates live portal
 *  config — surface a warning so the user opts into that consciously. */
function useTeslaWorking(): boolean {
  const teslaStatus = trpc.plugin.vehicle.tesla.teslaStatus.useQuery();
  return teslaStatus.data?.authenticated === true &&
    teslaStatus.data?.keyPaired === true;
}

function credentialsHint(valid: boolean, hasOrigin: boolean): string {
  if (!hasOrigin) {
    return "Start the tunnel on the Public Key Hosting step to continue";
  }
  if (!valid) return "Enter your Client ID and Client Secret to continue";
  return "Next saves your Tesla credentials";
}

function credentialsNext(
  { isValid, hasOrigin, save }: {
    isValid: boolean;
    hasOrigin: boolean;
    save: () => Promise<void>;
  },
): WizardNext {
  if (!isValid || !hasOrigin) {
    return { kind: "blocked", reason: credentialsHint(isValid, hasOrigin) };
  }
  return {
    kind: "ready",
    hint: credentialsHint(isValid, hasOrigin),
    onNext: save,
  };
}

export const teslaCredentialsStep: PluginStepDef = {
  id: "tesla-credentials",
  label: "Tesla Credentials",
  useStep: () => {
    const { data: teslaConfig } = useTeslaConfig();
    const [clientId, setClientId] = useState(
      teslaConfig?.teslaClientId || "",
    );
    const [clientSecret, setClientSecret] = useState(
      teslaConfig?.teslaClientSecret || "",
    );
    const [region, setRegion] = useState(teslaConfig?.teslaRegion || "na");

    const isValid = clientId.trim().length > 0 &&
      clientSecret.trim().length > 0;

    // Build the domain from the current window location for instructions
    const browserOrigin = typeof globalThis !== "undefined"
      ? globalThis.location.origin
      : "http://localhost:8000";

    // Check if tunnel is active (started on the Public Key Hosting step)
    const tunnelStatus = trpc.plugin.vehicle.tesla.tunnelStatus.useQuery();
    const tunnelUrl = tunnelStatus.data?.url;

    const oauth = resolveOAuthOrigin(browserOrigin, tunnelUrl);
    const redirectUri = oauth.origin ? callbackUrl(oauth.origin) : null;

    // Partner registration requires the public key domain in Allowed Origins
    // (Tesla: "Root domain must match registered allowed origin"). Resolved
    // live so the instructions can never show a stale tunnel domain.
    const hosting = teslaConfig?.teslaPublicKeyHosting ?? "";
    const savedDomain = teslaConfig?.teslaPublicKeyDomain ?? null;
    const allowedOrigin =
      resolvePublicKeyDomain(hosting, savedDomain, tunnelUrl ?? null) ?? "";

    const teslaWorking = useTeslaWorking();

    const saveMutation = useTeslaConfigMutation();

    const save = useCallback(async () => {
      await saveMutation.mutateAsync({
        teslaClientId: clientId.trim(),
        teslaClientSecret: clientSecret.trim(),
        teslaRegion: region as "na" | "eu" | "cn",
      });
    }, [saveMutation, clientId, clientSecret, region]);

    return {
      next: credentialsNext({ isValid, hasOrigin: !!oauth.origin, save }),
      view: (
        <div className={styles.stepContainer}>
          <Text as="p" size="3" color="gray">
            Enter your Tesla Fleet API credentials. You'll need to create an
            application on the Tesla Developer Portal first.
          </Text>

          {teslaWorking && <AlreadyWorkingCallout />}

          <OriginCallouts
            viaTunnel={oauth.viaTunnel}
            origin={oauth.origin}
            browserOrigin={browserOrigin}
          />

          {redirectUri && (
            <DeveloperPortalInstructions
              allowedOrigin={allowedOrigin}
              redirectUri={redirectUri}
              viaTunnel={oauth.viaTunnel}
            />
          )}

          <CredentialInputs
            clientId={clientId}
            setClientId={setClientId}
            clientSecret={clientSecret}
            setClientSecret={setClientSecret}
            region={region}
            setRegion={setRegion}
          />
        </div>
      ),
    };
  },
};
