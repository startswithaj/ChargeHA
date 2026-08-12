import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import {
  SettingsRow,
  usePluginSettingsHost,
  useSaveStatus,
} from "../../../hostUi.ts";

interface FroniusCloudValues {
  froniusCloudEmail: string;
  froniusCloudPassword: string;
  froniusCloudPvSystemId: string;
}

type FroniusCloudDraft = Partial<FroniusCloudValues>;

// Buffered like FroniusLocalConfig: a write per keystroke would rebuild the
// energy adapter against every half-typed credential (config_changed →
// poller).
function useFroniusCloudDraft(config: FroniusCloudValues | undefined) {
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.fronius_cloud.setConfig.useMutation(
    {
      onSuccess: () => utils.plugin.energy.fronius_cloud.getConfig.invalidate(),
    },
  );
  const [draft, setDraft] = useState<FroniusCloudDraft>({});
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();

  const froniusCloudEmail = draft.froniusCloudEmail ??
    config?.froniusCloudEmail ?? "";
  const froniusCloudPassword = draft.froniusCloudPassword ??
    config?.froniusCloudPassword ?? "";
  const froniusCloudPvSystemId = draft.froniusCloudPvSystemId ??
    config?.froniusCloudPvSystemId ?? "";
  const isDirty = Object.keys(draft).length > 0;

  const save = useCallback(() => {
    if (!isDirty) return;
    onMutate();
    configMutation.mutate(
      { froniusCloudEmail, froniusCloudPassword, froniusCloudPvSystemId },
      {
        onSuccess: () => {
          onSuccess();
          setDraft({});
        },
        onError,
      },
    );
  }, [
    isDirty,
    froniusCloudEmail,
    froniusCloudPassword,
    froniusCloudPvSystemId,
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

  return {
    froniusCloudEmail,
    froniusCloudPassword,
    froniusCloudPvSystemId,
    setDraft,
  };
}

export function FroniusCloudConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.fronius_cloud.getConfig
    .useQuery();
  const testMutation = trpc.plugin.energy.fronius_cloud.testConnection
    .useMutation();

  const {
    froniusCloudEmail,
    froniusCloudPassword,
    froniusCloudPvSystemId,
    setDraft,
  } = useFroniusCloudDraft(config as FroniusCloudValues | undefined);

  if (!config) return null;

  return (
    <>
      <Text size="1" color="gray">
        We recommend creating a dedicated <code>guest</code>{" "}
        user for ChargeHA: log in to <strong>solarweb.com</strong>{" "}
        → Settings → Permissions → add a new user as <code>guest</code>.
      </Text>

      <SettingsRow label="Email">
        <TextField.Root
          size="2"
          placeholder="your@email.com"
          value={froniusCloudEmail}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, froniusCloudEmail: e.target.value }))}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow label="Password">
        <TextField.Root
          size="2"
          type="password"
          placeholder="Solar.web password"
          value={froniusCloudPassword}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, froniusCloudPassword: e.target.value }))}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow
        label="PV System ID"
        help="Find this in your Solar.web URL: solarweb.com/PvSystems/PvSystem?pvSystemId=this-value"
      >
        <TextField.Root
          size="2"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={froniusCloudPvSystemId}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, froniusCloudPvSystemId: e.target.value }))}
          style={{ width: 320 }}
        />
      </SettingsRow>

      {/* Test connection */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!froniusCloudEmail ||
            !froniusCloudPassword ||
            !froniusCloudPvSystemId ||
            testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              email: froniusCloudEmail,
              password: froniusCloudPassword,
              pvSystemId: froniusCloudPvSystemId,
            })}
        >
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>

        {testMutation.isSuccess && testMutation.data.success && (
          <Badge color="green" size="2">
            Connected{testMutation.data.systemName
              ? ` — ${testMutation.data.systemName}`
              : ""}
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
    </>
  );
}
