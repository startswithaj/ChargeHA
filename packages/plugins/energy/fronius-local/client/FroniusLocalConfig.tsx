import { useState } from "react";
import { Badge, Button, Code, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../../client/src/components/pages/Settings/SettingsLayout.tsx";

function SearchControls(
  { subnet, setSubnet, searchMutation }: {
    subnet: string;
    setSubnet: (v: string) => void;
    searchMutation: ReturnType<
      typeof trpc.plugin.energy.fronius_local.discover.useMutation
    >;
  },
) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="1"
          variant="soft"
          disabled={searchMutation.isPending}
          onClick={() => searchMutation.mutate({ subnet: subnet || undefined })}
        >
          {searchMutation.isPending ? "Scanning..." : "Search Network"}
        </Button>
        <Text size="1" color="gray">or enter subnet:</Text>
        <TextField.Root
          size="1"
          placeholder="e.g. 192.168.0"
          value={subnet}
          onChange={(e: { target: { value: string } }) =>
            setSubnet(e.target.value)}
          style={{ width: 100 }}
        />
      </div>
      {searchMutation.isPending && (
        <Text size="1" color="gray">
          Scanning {subnet ? `subnet ${subnet}.*` : "your local network"}{" "}
          for Fronius inverters...
        </Text>
      )}
    </>
  );
}

function SearchResults(
  { searchResults, onUse }: {
    searchResults: { host: string; name: string }[];
    onUse: (host: string) => void;
  },
) {
  if (searchResults.length === 0) {
    return (
      <Text size="2" color="orange">
        No Fronius inverters found. Try entering your subnet above (check your
        router settings or run <Code size="1">ifconfig</Code>).
      </Text>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {searchResults.map((d) => (
        <div
          key={d.host}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: 6,
            background: "var(--gray-a2)",
          }}
        >
          <div>
            <Text size="2" weight="medium">{d.name}</Text>
            <Text size="1" color="gray" style={{ display: "block" }}>
              {d.host}
            </Text>
          </div>
          <Button size="1" variant="soft" onClick={() => onUse(d.host)}>
            Use
          </Button>
        </div>
      ))}
    </div>
  );
}

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

      <SearchControls
        subnet={subnet}
        setSubnet={setSubnet}
        searchMutation={searchMutation}
      />

      {searchDone && (
        <SearchResults
          searchResults={searchResults}
          onUse={(host) => {
            configMutation.mutate({ froniusHost: host });
            searchMutation.reset();
            testMutation.mutate({
              host,
              meterDeviceId: parseInt(config.froniusMeterDeviceId || "0"),
            });
          }}
        />
      )}

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
