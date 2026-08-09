import { useMemo } from "react";
import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../hostUi.ts";
import { type StationOption, StationPicker } from "./StationPicker.tsx";

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

/** Re-list the account's stations from Settings, so the station can be changed
 *  without walking back through the setup wizard. */
function StationSection(
  { account, password, stationId, stationsMutation, onSelect }: {
    account: string;
    password: string;
    stationId: string;
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
          onClick={() => stationsMutation.mutate({ account, password })}
        >
          {stationsMutation.isPending ? "Loading..." : "Load Stations"}
        </Button>
        {error && <Text size="2" color="red">{error}</Text>}
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
  { account, password, stationId, testMutation }: {
    account: string;
    password: string;
    stationId: string;
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
        onClick={() => testMutation.mutate({ account, password, stationId })}
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
  );
}

export function GoodweSemsConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.goodwe_sems.getConfig.useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.goodwe_sems.setConfig.useMutation({
    onSuccess: () => utils.plugin.energy.goodwe_sems.getConfig.invalidate(),
  });
  const stationsMutation = trpc.plugin.energy.goodwe_sems.listStations
    .useMutation();
  const testMutation = trpc.plugin.energy.goodwe_sems.testConnection
    .useMutation();

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
          value={config.goodweSemsAccount}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ goodweSemsAccount: e.target.value })}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow label="Password">
        <TextField.Root
          size="2"
          type="password"
          placeholder="SEMS Portal password"
          value={config.goodweSemsPassword}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ goodweSemsPassword: e.target.value })}
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
          value={config.goodweSemsStationId}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ goodweSemsStationId: e.target.value })}
          style={{ width: 320 }}
        />
      </SettingsRow>

      <StationSection
        account={config.goodweSemsAccount}
        password={config.goodweSemsPassword}
        stationId={config.goodweSemsStationId}
        stationsMutation={stationsMutation}
        onSelect={(goodweSemsStationId: string) =>
          configMutation.mutate({ goodweSemsStationId })}
      />

      <TestConnectionRow
        account={config.goodweSemsAccount}
        password={config.goodweSemsPassword}
        stationId={config.goodweSemsStationId}
        testMutation={testMutation}
      />
    </>
  );
}
