import { useState } from "react";
import { Badge, Button, Code, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { NetworkDeviceSearch, SettingsRow } from "../../../hostUi.ts";

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

export function FroniusLocalConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.fronius_local.getConfig
    .useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.fronius_local.setConfig.useMutation(
    {
      onSuccess: () => utils.plugin.energy.fronius_local.getConfig.invalidate(),
    },
  );
  const [subnet, setSubnet] = useState("");

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
          value={config.froniusHost}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ froniusHost: e.target.value })}
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
          configMutation.mutate({ froniusHost: d.host });
          searchMutation.reset();
          testMutation.mutate({
            host: d.host,
            meterDeviceId: parseInt(config.froniusMeterDeviceId || "0"),
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
          value={config.froniusMeterDeviceId}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ froniusMeterDeviceId: e.target.value })}
          style={{ width: 80 }}
        />
      </SettingsRow>

      <TestSection
        config={config as { froniusHost: string; froniusMeterDeviceId: string }}
        testMutation={testMutation}
        testSuccess={testSuccess}
      />
    </>
  );
}
