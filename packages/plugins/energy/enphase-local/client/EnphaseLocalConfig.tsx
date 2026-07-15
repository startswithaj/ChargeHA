import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  SegmentedControl,
  Text,
  TextField,
} from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../hostUi.ts";
import { useSaveStatus } from "../../../hostUi.ts";
import { usePluginSettingsHost } from "../../../hostUi.ts";

type AuthMethod = "credentials" | "token";

interface EnphaseLocalConfigValues {
  host: string;
  email: string;
  password: string;
  token: string;
}

type ValueOf = (key: keyof EnphaseLocalConfigValues) => string;
type TestMutation = ReturnType<
  typeof trpc.plugin.energy.enphase_local.testConnection.useMutation
>;

/** Only the active method's values are saved; saving credentials leaves the
 *  stored token untouched so it keeps serving as the renewable cached owner
 *  token, while switching to a pasted token clears the credentials. A token
 *  fetched during a connection test is saved along with the credentials so
 *  the first poll doesn't need another cloud round-trip. */
function savePayload(
  method: AuthMethod,
  value: ValueOf,
  fetchedToken: string,
) {
  if (method === "credentials") {
    const base = {
      host: value("host"),
      email: value("email"),
      password: value("password"),
    };
    return fetchedToken ? { ...base, token: fetchedToken } : base;
  }
  return {
    host: value("host"),
    email: "",
    password: "",
    token: value("token"),
  };
}

function testInput(method: AuthMethod, value: ValueOf) {
  if (method === "credentials") {
    return {
      host: value("host"),
      email: value("email"),
      password: value("password"),
    };
  }
  return { host: value("host"), token: value("token") };
}

function canTest(method: AuthMethod, value: ValueOf): boolean {
  if (!value("host")) return false;
  if (method === "credentials") {
    return Boolean(value("email") && value("password"));
  }
  return Boolean(value("token"));
}

function ConfigField(
  { label, help, value, width, type, placeholder, onChange }: {
    label: string;
    help?: string;
    value: string;
    width: number;
    type?: string;
    placeholder?: string;
    onChange: (v: string) => void;
  },
) {
  return (
    <SettingsRow label={label} help={help}>
      <TextField.Root
        size="2"
        type={type as "text" | "password" | undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e: { target: { value: string } }) =>
          onChange(e.target.value)}
        style={{ width }}
      />
    </SettingsRow>
  );
}

function AuthSection(
  { method, setMethod, value, setField }: {
    method: AuthMethod;
    setMethod: (m: AuthMethod) => void;
    value: ValueOf;
    setField: (key: keyof EnphaseLocalConfigValues, v: string) => void;
  },
) {
  return (
    <>
      <SettingsRow
        label="Authorisation"
        help="Sign in with your Enphase account email and password, or paste an access token."
      >
        <SegmentedControl.Root
          value={method}
          onValueChange={(v: string) => setMethod(v as AuthMethod)}
        >
          <SegmentedControl.Item value="credentials">
            Enphase account
          </SegmentedControl.Item>
          <SegmentedControl.Item value="token">
            Access token
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </SettingsRow>

      {method === "credentials" && (
        <>
          <ConfigField
            label="Enphase account email"
            help="Used to fetch and renew the local API token automatically."
            value={value("email")}
            width={220}
            placeholder="you@example.com"
            onChange={(v) => setField("email", v)}
          />
          <ConfigField
            label="Enphase account password"
            value={value("password")}
            width={220}
            type="password"
            onChange={(v) => setField("password", v)}
          />
        </>
      )}

      {method === "token" && (
        <ConfigField
          label="Access token"
          help="Generated at entrez.enphaseenergy.com; valid for 1 year and replaced manually."
          value={value("token")}
          width={220}
          type="password"
          onChange={(v) => setField("token", v)}
        />
      )}
    </>
  );
}

function TestConnectionRow(
  { testMutation, disabled, onTest }: {
    testMutation: TestMutation;
    disabled: boolean;
    onTest: () => void;
  },
) {
  const success = testMutation.isSuccess && testMutation.data.success
    ? testMutation.data
    : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button
        size="2"
        variant="soft"
        disabled={disabled || testMutation.isPending}
        onClick={onTest}
      >
        {testMutation.isPending ? "Testing..." : "Test Connection"}
      </Button>

      {success?.device && (
        <Badge color="green" size="2">
          Connected — {success.device.name}
          {success.serial ? ` (${success.serial})` : ""}
        </Badge>
      )}
      {testMutation.isError && (
        <Text size="2" color="red">{testMutation.error.message}</Text>
      )}
      {testMutation.isSuccess && !testMutation.data.success && (
        <Text size="2" color="red">
          {testMutation.data.error ?? "Connection failed"}
        </Text>
      )}
    </div>
  );
}

/**
 * Settings panel for the Enphase Local plugin. Edits are buffered and saved
 * via the host panel's Save button (like PluginConfigForm).
 */
export function EnphaseLocalConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.enphase_local.getConfig
    .useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.enphase_local.setConfig.useMutation(
    {
      onSuccess: () => utils.plugin.energy.enphase_local.getConfig.invalidate(),
    },
  );
  const testMutation = trpc.plugin.energy.enphase_local.testConnection
    .useMutation();

  const [draft, setDraft] = useState<Partial<EnphaseLocalConfigValues>>({});
  const [methodOverride, setMethodOverride] = useState<AuthMethod | null>(
    null,
  );
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();

  const cfg = config as EnphaseLocalConfigValues | undefined;
  const value: ValueOf = (key) => draft[key] ?? cfg?.[key] ?? "";
  const method: AuthMethod = methodOverride ??
    (cfg?.token && !cfg?.email ? "token" : "credentials");
  const isDirty = Object.keys(draft).length > 0 || methodOverride !== null;
  const testData = testMutation.isSuccess ? testMutation.data : null;
  const fetchedToken = testData?.success ? testData.fetchedToken ?? "" : "";

  const save = useCallback(() => {
    if (!isDirty) return;
    onMutate();
    configMutation.mutate(savePayload(method, value, fetchedToken), {
      onSuccess: () => {
        onSuccess();
        setDraft({});
        setMethodOverride(null);
      },
      onError,
    });
  }, [
    isDirty,
    method,
    draft,
    cfg,
    fetchedToken,
    configMutation,
    onMutate,
    onSuccess,
    onError,
  ]);

  const report = usePluginSettingsHost();
  useEffect(() => {
    report?.({ isDirty, save, saveStatus });
  }, [report, isDirty, save, saveStatus]);
  useEffect(() => () => report?.(null), [report]);

  if (!cfg) return null;

  return (
    <>
      <ConfigField
        label="Envoy IP address"
        help="Local IP or hostname of your Enphase Envoy / IQ Gateway. The gateway serial is read from the device automatically."
        value={value("host")}
        width={150}
        placeholder="192.168.1.60"
        onChange={(v) => setDraft((d) => ({ ...d, host: v }))}
      />

      <AuthSection
        method={method}
        setMethod={setMethodOverride}
        value={value}
        setField={(key, v) => setDraft((d) => ({ ...d, [key]: v }))}
      />

      <TestConnectionRow
        testMutation={testMutation}
        disabled={!canTest(method, value)}
        onTest={() => testMutation.mutate(testInput(method, value))}
      />
    </>
  );
}
