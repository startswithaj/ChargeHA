import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import { Globe, KeyRound, ShieldOff } from "lucide-react";
import { trpc } from "../../../trpc.ts";
import { Feature, isFeatureEnabled } from "../../../lib/featureFlags.ts";
import type { StepProps } from "../WizardShell.tsx";
import styles from "./steps.module.css";

type AuthMode = "none" | "local" | "oidc";

interface LocalForm {
  username: string;
  password: string;
}

interface OidcForm {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

/** Map OIDC error codes to user-friendly messages. */
const OIDC_ERROR_MESSAGES: Record<string, string> = {
  provider_denied: "The identity provider denied the request.",
  state_mismatch: "Session expired or state mismatch. Please try again.",
  token_exchange_failed:
    "Token exchange failed. Check your OIDC configuration.",
  provider_unreachable:
    "Could not reach the identity provider. Check the issuer URL.",
};

function validateLocal(form: LocalForm): string | null {
  if (form.username.length < 1) return "Username is required";
  if (form.password.length < 1) {
    return "Password is required";
  }
  return null;
}

function validateOidc(form: OidcForm): string | null {
  if (!form.issuerUrl) return "Issuer URL is required";
  if (!form.clientId) return "Client ID is required";
  if (!form.clientSecret) return "Client secret is required";
  if (!form.baseUrl) return "Base URL is required";
  return null;
}

function ModeCard(
  { mode, selected, disabled, icon, title, description, onSelect }: {
    mode: AuthMode;
    selected: boolean;
    disabled?: boolean;
    icon: React.ReactNode;
    title: string;
    description: string;
    onSelect: (mode: AuthMode) => void;
  },
) {
  return (
    <div
      className={`${styles.optionCard} ${
        selected ? styles.optionCardSelected : ""
      }`}
      role="button"
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
      onClick={() => {
        if (!disabled) onSelect(mode);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") onSelect(mode);
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {icon}
        <Text weight="bold">{title}</Text>
      </div>
      <Text size="2" color="gray">{description}</Text>
    </div>
  );
}

function LocalFormFields(
  { localForm, setLocalForm }: {
    localForm: LocalForm;
    setLocalForm: React.Dispatch<React.SetStateAction<LocalForm>>;
  },
) {
  return (
    <div
      className={styles.fieldGroup}
      style={{ paddingLeft: "1rem" }}
      data-testid="local-form"
    >
      <Text as="label" size="2" weight="medium">Username</Text>
      <TextField.Root
        placeholder="admin"
        value={localForm.username}
        onChange={(e) =>
          setLocalForm((f) => ({ ...f, username: e.target.value }))}
        aria-label="Username"
      />
      <Text as="label" size="2" weight="medium">Password</Text>
      <TextField.Root
        type="password"
        placeholder="Enter password"
        value={localForm.password}
        onChange={(e) =>
          setLocalForm((f) => ({ ...f, password: e.target.value }))}
        aria-label="Password"
      />
    </div>
  );
}

function OidcFormFields(
  { oidcForm, setOidcForm, redirectUri }: {
    oidcForm: OidcForm;
    setOidcForm: React.Dispatch<React.SetStateAction<OidcForm>>;
    redirectUri: string;
  },
) {
  return (
    <div
      className={styles.fieldGroup}
      style={{ paddingLeft: "1rem" }}
      data-testid="oidc-form"
    >
      <Text as="label" size="2" weight="medium">Issuer URL</Text>
      <TextField.Root
        placeholder="https://auth.example.com"
        value={oidcForm.issuerUrl}
        onChange={(e) =>
          setOidcForm((f) => ({ ...f, issuerUrl: e.target.value }))}
        aria-label="Issuer URL"
      />
      <Text as="label" size="2" weight="medium">Client ID</Text>
      <TextField.Root
        placeholder="chargeha"
        value={oidcForm.clientId}
        onChange={(e) =>
          setOidcForm((f) => ({ ...f, clientId: e.target.value }))}
        aria-label="Client ID"
      />
      <Text as="label" size="2" weight="medium">Client Secret</Text>
      <TextField.Root
        type="password"
        placeholder="Client secret"
        value={oidcForm.clientSecret}
        onChange={(e) =>
          setOidcForm((f) => ({ ...f, clientSecret: e.target.value }))}
        aria-label="Client Secret"
      />
      <Text as="label" size="2" weight="medium">Base URL</Text>
      <TextField.Root
        placeholder={globalThis.location?.origin ??
          "https://chargeha.example.com"}
        value={oidcForm.baseUrl}
        onChange={(e) =>
          setOidcForm((f) => ({ ...f, baseUrl: e.target.value }))}
        aria-label="Base URL"
      />
      <Text as="p" size="1" color="gray">
        The URL you use to access ChargeHA in your browser.
      </Text>
      {oidcForm.issuerUrl.startsWith("http://") && (
        <Text as="p" size="2" color="orange">
          This issuer URL uses HTTP. Tokens will be transmitted in plaintext.
          Use HTTPS if exposed to the internet.
        </Text>
      )}
      {redirectUri && (
        <div className={styles.fieldGroup} style={{ marginTop: "0.5rem" }}>
          <Text as="label" size="2" weight="medium">Redirect URI</Text>
          <TextField.Root
            value={redirectUri}
            readOnly
            aria-label="Redirect URI"
          />
          <Text as="p" size="1" color="gray">
            Copy this into your identity provider's allowed redirect URIs.
          </Text>
        </div>
      )}
    </div>
  );
}

function useAuthEffects(
  setSelectedMode: (mode: AuthMode) => void,
  setValidationError: (e: string | null) => void,
  sessionRefetch: () => Promise<
    { data?: { authenticated: boolean; authMode: string } | undefined }
  >,
  onNext: () => void,
) {
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search);
    const error = params.get("error");
    if (error) {
      setSelectedMode("oidc");
      setValidationError(
        OIDC_ERROR_MESSAGES[error] ?? `Authentication failed: ${error}`,
      );
      const url = new URL(globalThis.location.href);
      url.searchParams.delete("error");
      globalThis.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search);
    if (params.get("error")) return;
    sessionRefetch().then((result) => {
      if (
        result.data?.authenticated && result.data?.authMode === "oidc"
      ) {
        onNext();
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function useAuthStepState(onNext: () => void) {
  const [selectedMode, setSelectedMode] = useState<AuthMode | null>(null);
  const [localForm, setLocalForm] = useState<LocalForm>({
    username: "",
    password: "",
  });
  const [oidcForm, setOidcForm] = useState<OidcForm>({
    issuerUrl: "",
    clientId: "",
    clientSecret: "",
    baseUrl: "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setAuthMode = trpc.wizard.setAuthMode.useMutation();
  const saveOidcConfig = trpc.wizard.saveOidcConfig.useMutation();
  const sessionQuery = trpc.auth.session.useQuery(undefined, {
    enabled: false,
  });

  useAuthEffects(
    setSelectedMode,
    setValidationError,
    sessionQuery.refetch,
    onNext,
  );

  const redirectUri = useMemo(() => {
    if (!oidcForm.baseUrl) return "";
    const base = oidcForm.baseUrl.replace(/\/+$/, "");
    return `${base}/auth/oidc/callback`;
  }, [oidcForm.baseUrl]);

  const handleNext = useCallback(async () => {
    setValidationError(null);
    if (!selectedMode) {
      setValidationError("Please select an authentication mode");
      return;
    }
    if (selectedMode === "local") {
      const error = validateLocal(localForm);
      if (error) {
        setValidationError(error);
        return;
      }
    }
    if (selectedMode === "oidc") {
      const error = validateOidc(oidcForm);
      if (error) {
        setValidationError(error);
        return;
      }
    }
    setSaving(true);
    try {
      if (selectedMode === "oidc") {
        await saveOidcConfig.mutateAsync(oidcForm);
        globalThis.location.href = "/auth/oidc/login?return=wizard";
        return;
      }
      await setAuthMode.mutateAsync({
        mode: selectedMode,
        localConfig: selectedMode === "local" ? localForm : undefined,
        oidcConfig: undefined,
      });
      onNext();
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : "Failed to save auth settings",
      );
    } finally {
      setSaving(false);
    }
  }, [selectedMode, localForm, oidcForm, onNext, setAuthMode, saveOidcConfig]);

  const selectMode = (mode: AuthMode) => {
    setSelectedMode(mode);
    setValidationError(null);
  };

  return {
    selectedMode,
    localForm,
    setLocalForm,
    oidcForm,
    setOidcForm,
    validationError,
    saving,
    redirectUri,
    handleNext,
    selectMode,
  };
}

export function AuthStep({ onNext }: StepProps) {
  const {
    selectedMode,
    localForm,
    setLocalForm,
    oidcForm,
    setOidcForm,
    validationError,
    saving,
    redirectUri,
    handleNext,
    selectMode,
  } = useAuthStepState(onNext);

  const oidcEnabled = isFeatureEnabled(Feature.OidcAuth);

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Choose how you want to protect access to ChargeHA. You can change this
        later in Settings.
      </Text>

      <div className={styles.optionCards}>
        <ModeCard
          mode="none"
          selected={selectedMode === "none"}
          icon={<ShieldOff size={18} />}
          title="No Authentication"
          description="Anyone on your network can access ChargeHA without logging in."
          onSelect={selectMode}
        />
        <ModeCard
          mode="local"
          selected={selectedMode === "local"}
          icon={<KeyRound size={18} />}
          title="Username & Password"
          description="Protect access with a local username and password."
          onSelect={selectMode}
        />
        {selectedMode === "local" && (
          <LocalFormFields localForm={localForm} setLocalForm={setLocalForm} />
        )}
        <ModeCard
          mode="oidc"
          selected={selectedMode === "oidc"}
          disabled={!oidcEnabled}
          icon={<Globe size={18} />}
          title="OpenID Connect (OIDC)"
          description={oidcEnabled
            ? "Delegate authentication to an external identity provider such as Authentik, Keycloak, or Google."
            : "Not available in demo mode."}
          onSelect={selectMode}
        />
        {oidcEnabled && selectedMode === "oidc" && (
          <OidcFormFields
            oidcForm={oidcForm}
            setOidcForm={setOidcForm}
            redirectUri={redirectUri}
          />
        )}
      </div>

      {validationError && (
        <Text as="p" size="2" color="red">
          {validationError}
        </Text>
      )}

      <div className={styles.stepActions}>
        <Button onClick={handleNext} disabled={saving}>
          {saving ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
