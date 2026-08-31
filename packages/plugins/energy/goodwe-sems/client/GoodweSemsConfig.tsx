import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Switch, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import {
  SettingsRow,
  usePluginSettingsHost,
  useSaveStatus,
} from "../../../hostUi.ts";
import { type StationOption, StationPicker } from "./StationPicker.tsx";
import { USE_SEMS_PLUS_HELP, USE_SEMS_PLUS_LABEL } from "./fields.ts";
import { FormError } from "../../../hostUi.ts";

type ListStationsMutation = ReturnType<
  typeof trpc.plugin.energy.goodwe_sems.listStations.useMutation
>;
type TestMutation = ReturnType<
  typeof trpc.plugin.energy.goodwe_sems.testConnection.useMutation
>;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
} as const;

interface GoodweSemsValues {
  goodweSemsAccount: string;
  goodweSemsPassword: string;
  goodweSemsStationId: string;
  goodweSemsUseSemsPlus: boolean;
}

type GoodweSemsDraft = Partial<GoodweSemsValues>;

/** Buffered like FroniusLocalConfig: a write per keystroke would rebuild the
 *  energy adapter against every half-typed credential (config_changed →
 *  poller). */
function useGoodweSemsDraft(config: GoodweSemsValues | undefined) {
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.goodwe_sems.setConfig.useMutation({
    onSuccess: () => utils.plugin.energy.goodwe_sems.getConfig.invalidate(),
  });
  const [draft, setDraft] = useState<GoodweSemsDraft>({});
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();

  const goodweSemsAccount = draft.goodweSemsAccount ??
    config?.goodweSemsAccount ?? "";
  const goodweSemsPassword = draft.goodweSemsPassword ??
    config?.goodweSemsPassword ?? "";
  const goodweSemsStationId = draft.goodweSemsStationId ??
    config?.goodweSemsStationId ?? "";
  const goodweSemsUseSemsPlus = draft.goodweSemsUseSemsPlus ??
    config?.goodweSemsUseSemsPlus ?? false;
  const isDirty = Object.keys(draft).length > 0;

  const save = useCallback(() => {
    if (!isDirty) return;
    onMutate();
    configMutation.mutate(
      {
        goodweSemsAccount,
        goodweSemsPassword,
        goodweSemsStationId,
        goodweSemsUseSemsPlus,
      },
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
    goodweSemsAccount,
    goodweSemsPassword,
    goodweSemsStationId,
    goodweSemsUseSemsPlus,
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
    goodweSemsAccount,
    goodweSemsPassword,
    goodweSemsStationId,
    goodweSemsUseSemsPlus,
    setDraft,
  };
}

/** Re-list the account's stations from Settings, so the station can be changed
 *  without walking back through the setup wizard. */
function StationSection(
  { account, password, stationId, useSemsPlus, stationsMutation, onSelect }: {
    account: string;
    password: string;
    stationId: string;
    useSemsPlus: boolean;
    stationsMutation: ListStationsMutation;
    onSelect: (stationId: string) => void;
  },
) {
  const stations: StationOption[] = stationsMutation.data?.success
    ? stationsMutation.data.stations
    : [];

  const error = useMemo(() => {
    if (stationsMutation.isError) return stationsMutation.error.message;
    const data = stationsMutation.data;
    if (data && !data.success) return data.error ?? "Could not list stations";
    return null;
  }, [stationsMutation.isError, stationsMutation.error, stationsMutation.data]);

  return (
    <>
      <div style={rowStyle}>
        <Button
          size="2"
          variant="soft"
          disabled={!account || !password || stationsMutation.isPending}
          onClick={() =>
            stationsMutation.mutate({ account, password, useSemsPlus })}
        >
          {stationsMutation.isPending ? "Loading..." : "Load Stations"}
        </Button>
        <FormError message={error} />
      </div>

      <StationPicker
        stations={stations}
        selectedStationId={stationId}
        onSelect={onSelect}
        searched={stationsMutation.data !== undefined && !error}
      />
    </>
  );
}

function TestConnectionRow(
  { account, password, stationId, useSemsPlus, testMutation }: {
    account: string;
    password: string;
    stationId: string;
    useSemsPlus: boolean;
    testMutation: TestMutation;
  },
) {
  return (
    <div style={rowStyle}>
      <Button
        size="2"
        variant="soft"
        disabled={!account || !password || !stationId ||
          testMutation.isPending}
        onClick={() =>
          testMutation.mutate({ account, password, stationId, useSemsPlus })}
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
        <FormError message={testMutation.error.message} />
      )}
      {testMutation.isSuccess && !testMutation.data.success && (
        <FormError message={testMutation.data.error ?? "Connection failed"} />
      )}
    </div>
  );
}

export function GoodweSemsConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.goodwe_sems.getConfig.useQuery();
  const stationsMutation = trpc.plugin.energy.goodwe_sems.listStations
    .useMutation();
  const testMutation = trpc.plugin.energy.goodwe_sems.testConnection
    .useMutation();

  const {
    goodweSemsAccount,
    goodweSemsPassword,
    goodweSemsStationId,
    goodweSemsUseSemsPlus,
    setDraft,
  } = useGoodweSemsDraft(config as GoodweSemsValues | undefined);

  if (!config) return null;

  return (
    <>
      <Text size="1" color="gray">
        Uses your <strong>semsportal.com</strong>{" "}
        account. Grid and consumption readings require a GoodWe HomeKit or smart
        meter.
      </Text>

      <SettingsRow label="Account">
        <TextField.Root
          size="2"
          placeholder="your@email.com"
          value={goodweSemsAccount}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, goodweSemsAccount: e.target.value }))}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow label="Password">
        <TextField.Root
          size="2"
          type="password"
          placeholder="SEMS Portal password"
          value={goodweSemsPassword}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, goodweSemsPassword: e.target.value }))}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow
        label="Station ID"
        help="The power station this inverter belongs to. Use Load Stations to pick it from your account."
      >
        <TextField.Root
          size="2"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={goodweSemsStationId}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, goodweSemsStationId: e.target.value }))}
          style={{ width: 320 }}
        />
      </SettingsRow>

      <SettingsRow
        label={USE_SEMS_PLUS_LABEL}
        help={USE_SEMS_PLUS_HELP}
      >
        <Switch
          checked={goodweSemsUseSemsPlus}
          onCheckedChange={(goodweSemsUseSemsPlus: boolean) =>
            setDraft((d) => ({ ...d, goodweSemsUseSemsPlus }))}
        />
      </SettingsRow>

      <StationSection
        account={goodweSemsAccount}
        password={goodweSemsPassword}
        stationId={goodweSemsStationId}
        useSemsPlus={goodweSemsUseSemsPlus}
        stationsMutation={stationsMutation}
        onSelect={(goodweSemsStationId: string) =>
          setDraft((d) => ({ ...d, goodweSemsStationId }))}
      />

      <TestConnectionRow
        account={goodweSemsAccount}
        password={goodweSemsPassword}
        stationId={goodweSemsStationId}
        useSemsPlus={goodweSemsUseSemsPlus}
        testMutation={testMutation}
      />
    </>
  );
}
