import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Button,
  Dialog,
  Flex,
  Select,
  Separator,
  Text,
  TextField,
} from "@radix-ui/themes";
import { Shield } from "lucide-react";
import { trpc } from "../../../trpc.ts";
import { useRouter } from "../../../hooks/useRouter.ts";
import { demoMode, Feature } from "../../../lib/featureFlags.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";

type AuthMode = "none" | "local" | "oidc";

const MODE_LABELS: Record<AuthMode, string> = {
  none: "No Authentication",
  local: "Username & Password",
  oidc: "OpenID Connect (OIDC)",
};

/** Map OIDC error codes to user-friendly messages. */
const OIDC_ERROR_MESSAGES: Record<string, string> = {
  provider_denied: "The identity provider denied the request.",
  state_mismatch: "Session expired or state mismatch. Please try again.",
  token_exchange_failed:
    "Token exchange failed. Check your OIDC configuration.",
  provider_unreachable:
    "Could not reach the identity provider. Check the issuer URL.",
};

// ── Shared form fields ──

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

function LocalConfigFields(
  { localForm, setLocalForm }: {
    localForm: LocalForm;
    setLocalForm: React.Dispatch<React.SetStateAction<LocalForm>>;
  },
) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
      data-testid="local-config-form"
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

function OidcConfigFields(
  { oidcForm, setOidcForm, redirectUri, secretPlaceholder }: {
    oidcForm: OidcForm;
    setOidcForm: React.Dispatch<React.SetStateAction<OidcForm>>;
    redirectUri: string;
    secretPlaceholder?: string;
  },
) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
      data-testid="oidc-config-form"
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
        placeholder={secretPlaceholder ?? "Client secret"}
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
        <div style={{ marginTop: "0.25rem" }}>
          <Text as="label" size="1" color="gray">
            Redirect URI: {redirectUri}
          </Text>
        </div>
      )}
    </div>
  );
}

function validateLocal(form: LocalForm): string | null {
  if (form.username.length < 1) return "Username is required";
  if (form.password.length < 1) return "Password is required";
  return null;
}

function validateOidc(form: OidcForm): string | null {
  if (!form.issuerUrl) return "Issuer URL is required";
  if (!form.clientId) return "Client ID is required";
  if (!form.clientSecret) return "Client secret is required";
  if (!form.baseUrl) return "Base URL is required";
  return null;
}

function getSubmitLabel(
  isPending: boolean,
  resetAuthActive: boolean | undefined,
): string {
  if (isPending) return "Saving...";
  if (resetAuthActive) return "Set Password";
  return "Change Password";
}

// ── Change Password Form ──

function ChangePasswordFields(
  {
    resetAuthActive,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
  }: {
    resetAuthActive?: boolean;
    currentPassword: string;
    setCurrentPassword: (v: string) => void;
    newPassword: string;
    setNewPassword: (v: string) => void;
    confirmPassword: string;
    setConfirmPassword: (v: string) => void;
  },
) {
  return (
    <>
      {!resetAuthActive && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
        >
          <Text as="label" size="2">Current Password</Text>
          <TextField.Root
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            aria-label="Current Password"
          />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <Text as="label" size="2">New Password</Text>
        <TextField.Root
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Enter new password"
          autoComplete="new-password"
          aria-label="New Password"
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <Text as="label" size="2">Confirm New Password</Text>
        <TextField.Root
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          aria-label="Confirm New Password"
        />
      </div>
    </>
  );
}

function ChangePasswordForm({
  resetAuthActive,
}: {
  resetAuthActive?: boolean;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changePasswordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err) => {
      setError(
        err.message === "Invalid credentials"
          ? "Current password is incorrect"
          : err.message,
      );
    },
  });

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 1) {
      setError("New password is required");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    changePasswordMutation.mutate({
      currentPassword: resetAuthActive ? "" : currentPassword,
      newPassword,
    });
  }, [
    currentPassword,
    newPassword,
    confirmPassword,
    changePasswordMutation,
    resetAuthActive,
  ]);

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      data-testid="change-password-form"
    >
      <Text size="2" weight="bold">
        {resetAuthActive ? "Reset Password" : "Change Password"}
      </Text>

      <ChangePasswordFields
        resetAuthActive={resetAuthActive}
        currentPassword={currentPassword}
        setCurrentPassword={setCurrentPassword}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
      />

      {error && (
        <Text as="p" size="2" color="red" data-testid="password-error">
          {error}
        </Text>
      )}

      {success && (
        <Text as="p" size="2" color="green" data-testid="password-success">
          Password changed successfully
        </Text>
      )}

      <Button
        type="submit"
        size="2"
        variant="soft"
        disabled={(!resetAuthActive && !currentPassword) || !newPassword ||
          !confirmPassword || changePasswordMutation.isPending}
        style={{ alignSelf: "flex-start" }}
      >
        {getSubmitLabel(changePasswordMutation.isPending, resetAuthActive)}
      </Button>
    </form>
  );
}

// ── Mode Change Form ──

interface ModeChangeFormProps {
  currentMode: AuthMode;
  targetMode: AuthMode;
  onComplete: () => void;
  onCancel: () => void;
}

function ReAuthField(
  { currentPassword, setCurrentPassword }: {
    currentPassword: string;
    setCurrentPassword: (v: string) => void;
  },
) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <Text as="label" size="2" weight="medium">
        Current Password (re-authentication)
      </Text>
      <TextField.Root
        type="password"
        value={currentPassword}
        onChange={(e) =>
          setCurrentPassword(e.target.value)}
        aria-label="Current Password"
        autoFocus
      />
    </div>
  );
}

function FormButtons(
  { onCancel, isPending, submitLabel }: {
    onCancel: () => void;
    isPending: boolean;
    submitLabel: string;
  },
) {
  return (
    <Flex gap="2" style={{ alignSelf: "flex-start" }}>
      <Button type="submit" size="2" disabled={isPending}>
        {isPending ? "Saving..." : submitLabel}
      </Button>
      <Button
        type="button"
        size="2"
        variant="soft"
        color="gray"
        onClick={onCancel}
        disabled={isPending}
      >
        Cancel
      </Button>
    </Flex>
  );
}

function submitModeChange(
  {
    needsReAuth,
    currentPassword,
    targetMode,
    localForm,
    oidcForm,
    mutation,
    setError,
  }: {
    needsReAuth: boolean;
    currentPassword: string;
    targetMode: AuthMode;
    localForm: LocalForm;
    oidcForm: OidcForm;
    mutation: ReturnType<typeof trpc.auth.changeMode.useMutation>;
    setError: (e: string | null) => void;
  },
) {
  if (needsReAuth && !currentPassword) {
    setError("Current password is required to change auth mode");
    return;
  }
  if (targetMode === "local") {
    const v = validateLocal(localForm);
    if (v) return setError(v);
  }
  if (targetMode === "oidc") {
    const v = validateOidc(oidcForm);
    if (v) return setError(v);
  }
  const currentPw = needsReAuth ? currentPassword : undefined;
  if (targetMode === "local") {
    mutation.mutate({
      newMode: "local",
      currentPassword: currentPw,
      localConfig: localForm,
    });
  } else if (targetMode === "oidc") {
    mutation.mutate({
      newMode: "oidc",
      currentPassword: currentPw,
      oidcConfig: oidcForm,
    });
  } else {
    mutation.mutate({ newMode: "none", currentPassword: currentPw });
  }
}

function ModeChangeForm({
  currentMode,
  targetMode,
  onComplete,
  onCancel,
}: ModeChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
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
  const [error, setError] = useState<string | null>(null);

  const changeModeMutation = trpc.auth.changeMode.useMutation({
    onSuccess: () => onComplete(),
    onError: (err) => setError(err.message),
  });

  const needsReAuth = currentMode === "local";

  const redirectUri = useMemo(() => {
    if (!oidcForm.baseUrl) return "";
    const base = oidcForm.baseUrl.replace(/\/+$/, "");
    return `${base}/auth/oidc/callback`;
  }, [oidcForm.baseUrl]);

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    setError(null);
    submitModeChange({
      needsReAuth,
      currentPassword,
      targetMode,
      localForm,
      oidcForm,
      mutation: changeModeMutation,
      setError,
    });
  }, [
    needsReAuth,
    currentPassword,
    targetMode,
    localForm,
    oidcForm,
    changeModeMutation,
  ]);

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      data-testid="mode-change-form"
    >
      <Text size="2" color="gray">
        Switching from <Text weight="bold">{MODE_LABELS[currentMode]}</Text> to
        {" "}
        <Text weight="bold">{MODE_LABELS[targetMode]}</Text>
      </Text>

      {needsReAuth && (
        <ReAuthField
          currentPassword={currentPassword}
          setCurrentPassword={setCurrentPassword}
        />
      )}

      {targetMode === "local" && (
        <LocalConfigFields localForm={localForm} setLocalForm={setLocalForm} />
      )}
      {targetMode === "oidc" && (
        <OidcConfigFields
          oidcForm={oidcForm}
          setOidcForm={setOidcForm}
          redirectUri={redirectUri}
        />
      )}

      {error && (
        <Text as="p" size="2" color="red" data-testid="mode-change-error">
          {error}
        </Text>
      )}

      <FormButtons
        onCancel={onCancel}
        isPending={changeModeMutation.isPending}
        submitLabel="Confirm"
      />
    </form>
  );
}

// ── OIDC Edit Form ──

interface OidcEditFormProps {
  currentConfig:
    | { issuerUrl: string; clientId: string; baseUrl: string }
    | null;
  onCancel: () => void;
}

function OidcEditForm({ currentConfig, onCancel }: OidcEditFormProps) {
  const [oidcForm, setOidcForm] = useState<OidcForm>({
    issuerUrl: currentConfig?.issuerUrl ?? "",
    clientId: currentConfig?.clientId ?? "",
    clientSecret: "",
    baseUrl: currentConfig?.baseUrl ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  const updateOidcMutation = trpc.auth.updateOidcConfig.useMutation({
    onSuccess: () => {
      globalThis.location.href = "/auth/oidc/login?return=settings";
    },
    onError: (err) => setError(err.message),
  });

  const redirectUri = useMemo(() => {
    if (!oidcForm.baseUrl) return "";
    const base = oidcForm.baseUrl.replace(/\/+$/, "");
    return `${base}/auth/oidc/callback`;
  }, [oidcForm.baseUrl]);

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validateOidc(oidcForm);
    if (v) {
      setError(v);
      return;
    }
    updateOidcMutation.mutate(oidcForm);
  }, [oidcForm, updateOidcMutation]);

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      data-testid="oidc-edit-form"
    >
      <Text size="2" weight="bold">Edit OIDC Configuration</Text>
      <OidcConfigFields
        oidcForm={oidcForm}
        setOidcForm={setOidcForm}
        redirectUri={redirectUri}
        secretPlaceholder="Enter new client secret"
      />

      {error && (
        <Text as="p" size="2" color="red" data-testid="oidc-edit-error">
          {error}
        </Text>
      )}

      <FormButtons
        onCancel={onCancel}
        isPending={updateOidcMutation.isPending}
        submitLabel="Save & Verify"
      />
    </form>
  );
}

// ── Warning Dialog for switching to "none" ──

interface NoneWarningDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function NoneWarningDialog({
  open,
  onConfirm,
  onCancel,
}: NoneWarningDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <Dialog.Content maxWidth="450px">
        <Dialog.Title>Remove Authentication?</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          This will remove authentication. Anyone on your network will have full
          access.
        </Dialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" onClick={onCancel}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button color="red" onClick={onConfirm}>
            Remove Authentication
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ── Main AuthSettings Component ──

function useOidcUrlBanner(
  setOidcError: (s: string | null) => void,
  setOidcSuccess: (s: string | null) => void,
) {
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search);
    const error = params.get("error");
    const updated = params.get("oidc_updated");
    if (error) {
      setOidcError(
        OIDC_ERROR_MESSAGES[error] ?? `Authentication failed: ${error}`,
      );
    }
    if (updated) {
      setOidcSuccess("OIDC configuration updated successfully.");
    }
    if (error || updated) {
      const url = new URL(globalThis.location.href);
      url.searchParams.delete("error");
      url.searchParams.delete("oidc_updated");
      globalThis.history.replaceState({}, "", url.toString());
    }
  }, []);
}

function useAuthSettingsHandlers(
  { currentMode, targetMode, setTargetMode, setShowNoneWarning }: {
    currentMode: AuthMode;
    targetMode: AuthMode | null;
    setTargetMode: (m: AuthMode | null) => void;
    setShowNoneWarning: (b: boolean) => void;
  },
) {
  const queryClient = trpc.useUtils();
  const { navigate } = useRouter();

  const handleModeSelect = useCallback((value: string) => {
    const mode = value as AuthMode;
    if (mode === currentMode) {
      setTargetMode(null);
      return;
    }
    if (mode === "none") {
      setShowNoneWarning(true);
    } else {
      setTargetMode(mode);
    }
  }, [currentMode, setTargetMode, setShowNoneWarning]);

  const handleNoneConfirm = useCallback(() => {
    setShowNoneWarning(false);
    setTargetMode("none");
  }, [setShowNoneWarning, setTargetMode]);

  const handleNoneCancel = useCallback(() => {
    setShowNoneWarning(false);
  }, [setShowNoneWarning]);

  const handleModeChangeComplete = useCallback(() => {
    queryClient.auth.session.invalidate();
    setTargetMode(null);
    if (targetMode === "none") {
      navigate({ type: "app", page: "dashboard" });
    } else {
      navigate({ type: "login" });
    }
  }, [targetMode, queryClient, setTargetMode]);

  const handleModeChangeCancel = useCallback(() => {
    setTargetMode(null);
  }, [setTargetMode]);

  return {
    handleModeSelect,
    handleNoneConfirm,
    handleNoneCancel,
    handleModeChangeComplete,
    handleModeChangeCancel,
  };
}

function AuthModeRow(
  { value, oidcEnabled, onValueChange }: {
    value: string;
    oidcEnabled: boolean;
    onValueChange: (v: string) => void;
  },
) {
  return (
    <SettingsRow label="Auth mode">
      <Select.Root value={value} onValueChange={onValueChange}>
        <Select.Trigger style={{ minWidth: 240 }} aria-label="Auth mode" />
        <Select.Content>
          <Select.Item value="none">No Authentication</Select.Item>
          <Select.Item value="local">Username &amp; Password</Select.Item>
          <Select.Item value="oidc" disabled={!oidcEnabled}>
            OpenID Connect (OIDC){oidcEnabled ? "" : " — n/a in demo"}
          </Select.Item>
        </Select.Content>
      </Select.Root>
    </SettingsRow>
  );
}

function OidcBanners(
  { oidcSuccess, oidcError, showEditButton, onEditClick }: {
    oidcSuccess: string | null;
    oidcError: string | null;
    showEditButton: boolean;
    onEditClick: () => void;
  },
) {
  return (
    <>
      {oidcSuccess && (
        <Text as="p" size="2" color="green" data-testid="oidc-success">
          {oidcSuccess}
        </Text>
      )}
      {oidcError && (
        <Text as="p" size="2" color="red" data-testid="oidc-error">
          {oidcError}
        </Text>
      )}
      {showEditButton && (
        <Button
          size="2"
          variant="soft"
          style={{ alignSelf: "flex-start" }}
          onClick={onEditClick}
          data-testid="edit-oidc-button"
        >
          Edit OIDC Settings
        </Button>
      )}
    </>
  );
}

function AuthInfoRows(
  { currentMode, sessionData, oidcConfig }: {
    currentMode: AuthMode;
    sessionData: { username?: string } | undefined;
    oidcConfig:
      | { issuerUrl: string; clientId: string; baseUrl: string }
      | null
      | undefined;
  },
) {
  return (
    <>
      {currentMode === "local" && sessionData?.username && (
        <SettingsRow label="Username">
          <Text size="2">{sessionData.username}</Text>
        </SettingsRow>
      )}
      {currentMode === "oidc" && oidcConfig && (
        <>
          <SettingsRow label="Issuer URL">
            <Text size="2">{oidcConfig.issuerUrl}</Text>
          </SettingsRow>
          <SettingsRow label="Client ID">
            <Text size="2">{oidcConfig.clientId}</Text>
          </SettingsRow>
          <SettingsRow label="Base URL">
            <Text size="2">{oidcConfig.baseUrl}</Text>
          </SettingsRow>
        </>
      )}
    </>
  );
}

export function AuthSettings() {
  const { data: sessionData } = trpc.auth.session.useQuery();
  const currentMode = (sessionData?.authMode ?? "none") as AuthMode;
  const { data: oidcConfig } = trpc.auth.oidcConfig.useQuery(undefined, {
    enabled: currentMode === "oidc",
  });
  const [targetMode, setTargetMode] = useState<AuthMode | null>(null);
  const [showNoneWarning, setShowNoneWarning] = useState(false);
  const [showOidcEdit, setShowOidcEdit] = useState(false);
  const [oidcError, setOidcError] = useState<string | null>(null);
  const [oidcSuccess, setOidcSuccess] = useState<string | null>(null);

  useOidcUrlBanner(setOidcError, setOidcSuccess);

  const {
    handleModeSelect,
    handleNoneConfirm,
    handleNoneCancel,
    handleModeChangeComplete,
    handleModeChangeCancel,
  } = useAuthSettingsHandlers({
    currentMode,
    targetMode,
    setTargetMode,
    setShowNoneWarning,
  });

  return (
    <SettingsSection
      icon={<Shield size={18} />}
      title="Authentication"
      description="Manage how users access ChargeHA."
    >
      <AuthModeRow
        value={targetMode ?? currentMode}
        oidcEnabled={demoMode.allows(Feature.OidcAuth)}
        onValueChange={handleModeSelect}
      />

      <AuthInfoRows
        currentMode={currentMode}
        sessionData={sessionData ?? undefined}
        oidcConfig={oidcConfig}
      />

      <OidcBanners
        oidcSuccess={oidcSuccess}
        oidcError={oidcError}
        showEditButton={currentMode === "oidc" && !showOidcEdit &&
          targetMode === null}
        onEditClick={() => {
          setShowOidcEdit(true);
          setOidcError(null);
        }}
      />

      {/* OIDC edit form */}
      {showOidcEdit && (
        <>
          <Separator size="4" />
          <OidcEditForm
            currentConfig={oidcConfig ?? null}
            onCancel={() => setShowOidcEdit(false)}
          />
        </>
      )}

      {/* Mode change form — shown when a different mode is selected */}
      {targetMode !== null && (
        <ModeChangeForm
          currentMode={currentMode}
          targetMode={targetMode}
          onComplete={handleModeChangeComplete}
          onCancel={handleModeChangeCancel}
        />
      )}

      {/* Password change — only for local mode */}
      {currentMode === "local" && (
        <>
          <Separator size="4" />
          <ChangePasswordForm
            resetAuthActive={sessionData?.resetAuthActive === true}
          />
        </>
      )}

      {/* Warning dialog for switching to none */}
      <NoneWarningDialog
        open={showNoneWarning}
        onConfirm={handleNoneConfirm}
        onCancel={handleNoneCancel}
      />
    </SettingsSection>
  );
}
