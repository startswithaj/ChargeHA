import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Code, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import {
  NetworkDeviceSearch,
  SettingsRow,
  usePluginSettingsHost,
  useSaveStatus,
} from "../../../hostUi.ts";

function TestSection(
  { config, testMutation, testSuccess }: {
    config: { froniusHost: string; froniusMeterDeviceId: string };
    testMutation: ReturnType<
      typeof trpc.plugin.energy.fronius_local.testConnection.useMutation
    >;
    testSuccess: {
      device?: { name: string };
      realtime?: {
        solarProductionW: number;
        homeConsumptionW: number;
        gridPowerW: number;
      };
    } | null;
  },
) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!config.froniusHost || testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              host: config.froniusHost,
              meterDeviceId: parseInt(config.froniusMeterDeviceId || "0"),
            })}
        >
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>
        <TestResultDisplay
          testMutation={testMutation}
          testSuccess={testSuccess}
        />
      </div>
      {testSuccess?.realtime && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--green-a2)",
          }}
        >
          <Text size="1" color="gray">
            Solar: {(testSuccess.realtime.solarProductionW / 1000).toFixed(1)}
            {" "}
            kW
            {" / "}
            Home: {(testSuccess.realtime.homeConsumptionW / 1000).toFixed(1)} kW
            {" / "}
            Grid: {(testSuccess.realtime.gridPowerW / 1000).toFixed(1)} kW
          </Text>
        </div>
      )}
    </>
  );
}

function TestResultDisplay(
  { testMutation, testSuccess }: {
    testMutation: ReturnType<
      typeof trpc.plugin.energy.fronius_local.testConnection.useMutation
    >;
    testSuccess: {
      device?: { name: string };
      realtime?: {
        solarProductionW: number;
        homeConsumptionW: number;
        gridPowerW: number;
      };
    } | null;
  },
) {
  return (
    <>
      {testSuccess?.device && (
        <Badge color="green" size="2">
          Connected — {testSuccess.device.name}
        </Badge>
      )}
      {testMutation.isError && (
        <Text size="2" color="red">
          {testMutation.error instanceof Error
            ? testMutation.error.message
            : "Test failed"}
        </Text>
      )}
      {testMutation.isSuccess && !testMutation.data.success && (
        <Text size="2" color="red">
          {testMutation.data.error ?? "Connection failed"}
        </Text>
      )}
    </>
  );
}

type FroniusDraft = Partial<
  { froniusHost: string; froniusMeterDeviceId: string }
>;

// Buffered like EnphaseLocalConfig: a write per keystroke would rebuild the
// energy adapter against every half-typed host (config_changed → poller).
function useFroniusDraft(
  config: { froniusHost: string; froniusMeterDeviceId: string } | undefined,
) {
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.fronius_local.setConfig.useMutation(
    {
      onSuccess: () => utils.plugin.energy.fronius_local.getConfig.invalidate(),
    },
  );
  const [draft, setDraft] = useState<FroniusDraft>({});
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();

  const froniusHost = draft.froniusHost ?? config?.froniusHost ?? "";
  const froniusMeterDeviceId = draft.froniusMeterDeviceId ??
    config?.froniusMeterDeviceId ?? "";
  const isDirty = Object.keys(draft).length > 0;

  const save = useCallback(() => {
    if (!isDirty) return;
    onMutate();
    configMutation.mutate({ froniusHost, froniusMeterDeviceId }, {
      onSuccess: () => {
        onSuccess();
        setDraft({});
      },
      onError,
    });
  }, [
    isDirty,
    froniusHost,
    froniusMeterDeviceId,
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

  return { froniusHost, froniusMeterDeviceId, setDraft };
}

export function FroniusLocalConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.fronius_local.getConfig
    .useQuery();
  const [subnet, setSubnet] = useState("");
  const { froniusHost, froniusMeterDeviceId, setDraft } = useFroniusDraft(
    config as { froniusHost: string; froniusMeterDeviceId: string } | undefined,
  );

  const testMutation = trpc.plugin.energy.fronius_local.testConnection
    .useMutation();

  const searchMutation = trpc.plugin.energy.fronius_local.discover
    .useMutation();

  const searchDone = searchMutation.isSuccess || searchMutation.isError;
  const searchResults = searchMutation.data?.found ?? [];

  if (!config) return null;

  // Narrow the discriminated union: only access device/realtime when success is true
  const testSuccess = testMutation.isSuccess && testMutation.data.success
    ? testMutation.data
    : null;

  return (
    <>
      <SettingsRow
        label="Fronius IP address"
        help="Local IP of your Fronius inverter. Use Search to auto-detect it on your network."
      >
        <TextField.Root
          size="2"
          placeholder="192.168.1.50"
          value={froniusHost}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, froniusHost: e.target.value }))}
          style={{ width: 150 }}
        />
      </SettingsRow>

      <NetworkDeviceSearch
        deviceNoun="Fronius inverters"
        subnet={subnet}
        onSubnetChange={setSubnet}
        onSearch={() => searchMutation.mutate({ subnet: subnet || undefined })}
        isPending={searchMutation.isPending}
        searched={searchDone}
        results={searchResults}
        onUse={(d) => {
          setDraft((prev) => ({ ...prev, froniusHost: d.host }));
          searchMutation.reset();
          testMutation.mutate({
            host: d.host,
            meterDeviceId: parseInt(froniusMeterDeviceId || "0"),
          });
        }}
        emptyMessage={
          <>
            No Fronius inverters found. Try entering your subnet above (check
            your router settings or run <Code size="1">ifconfig</Code>).
          </>
        }
      />

      <SettingsRow
        label="Meter device ID"
        help="Usually 0 for a single smart meter. Check Fronius Solar.web if you have multiple."
      >
        <TextField.Root
          size="2"
          placeholder="0"
          value={froniusMeterDeviceId}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, froniusMeterDeviceId: e.target.value }))}
          style={{ width: 80 }}
        />
      </SettingsRow>

      <TestSection
        config={{ froniusHost, froniusMeterDeviceId }}
        testMutation={testMutation}
        testSuccess={testSuccess}
      />
    </>
  );
}
