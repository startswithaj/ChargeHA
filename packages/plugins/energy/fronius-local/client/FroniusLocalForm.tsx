import { useMemo, useState } from "react";
import { Button, Code, Text, TextField } from "@radix-ui/themes";
import { Search } from "lucide-react";
import { trpc } from "./trpc.ts";
import { Spinner } from "../../../hostUi.ts";
import { stepStyles as styles } from "../../../hostUi.ts";
import type { FroniusDevice, TestStatus } from "../../InverterSetupShared.tsx";
import { TestResultBadge } from "../../InverterSetupShared.tsx";

interface FroniusLocalFormProps {
  initialHost: string;
  initialMeterDeviceId: string;
  onTestSuccess: (host: string, meterDeviceId: string) => void;
}

function useTestStatus(
  testMutation: ReturnType<
    typeof trpc.plugin.energy.fronius_local.testConnection.useMutation
  >,
): TestStatus {
  return useMemo(() => {
    if (testMutation.isPending) return { status: "testing" };
    if (testMutation.isError) {
      return { status: "error", message: testMutation.error.message };
    }
    if (testMutation.isSuccess && testMutation.data.success) {
      return { status: "success", detail: testMutation.data.device?.name };
    }
    if (testMutation.isSuccess && !testMutation.data.success) {
      return {
        status: "error",
        message: testMutation.data.error ?? "Connection failed",
      };
    }
    return { status: "idle" };
  }, [
    testMutation.isPending,
    testMutation.isError,
    testMutation.isSuccess,
    testMutation.error,
    testMutation.data,
  ]);
}

function SearchSection(
  { subnet, setSubnet, searchMutation, searchResults, handleSelectDevice }: {
    subnet: string;
    setSubnet: (v: string) => void;
    searchMutation: ReturnType<
      typeof trpc.plugin.energy.fronius_local.discover.useMutation
    >;
    searchResults: FroniusDevice[];
    handleSelectDevice: (host: string) => void;
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
          {searchMutation.isPending ? <Spinner /> : <Search size={14} />}
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
          aria-label="Subnet"
        />
      </div>
      {searchMutation.isPending && (
        <Text size="1" color="gray">
          Scanning {subnet ? `subnet ${subnet}.*` : "your local network"}{" "}
          for Fronius inverters...
        </Text>
      )}
      {!searchMutation.isPending && searchResults.length > 0 && (
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
              <Button
                size="1"
                variant="soft"
                onClick={() => handleSelectDevice(d.host)}
              >
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
      {searchMutation.isSuccess && searchResults.length === 0 && (
        <Text size="2" color="orange">
          No Fronius inverters found. Try entering your subnet above (check your
          router settings or run <Code size="1">ifconfig</Code>).
        </Text>
      )}
    </>
  );
}

export function FroniusLocalForm({
  initialHost,
  initialMeterDeviceId,
  onTestSuccess,
}: FroniusLocalFormProps): JSX.Element {
  const [froniusHost, setFroniusHost] = useState(initialHost);
  const [meterDeviceId, setMeterDeviceId] = useState(initialMeterDeviceId);
  const [subnet, setSubnet] = useState(() => {
    // Auto-detect subnet from browser hostname if it's an IP address
    const hostname = globalThis.location?.hostname ?? "";
    const match = hostname.match(/^(\d+\.\d+\.\d+)\.\d+$/);
    return match ? match[1] : "";
  });
  const [searchResults, setSearchResults] = useState<FroniusDevice[]>([]);

  const searchMutation = trpc.plugin.energy.fronius_local.discover.useMutation({
    onSuccess: (result: { found: FroniusDevice[] }) =>
      setSearchResults(result.found),
    onError: () => setSearchResults([]),
  });

  const testMutation = trpc.plugin.energy.fronius_local.testConnection
    .useMutation({
      onSuccess: (
        data: { success: boolean },
        variables: { host: string; meterDeviceId?: number },
      ) => {
        if (data.success) {
          onTestSuccess(variables.host, String(variables.meterDeviceId ?? 0));
        }
      },
    });

  const testResult = useTestStatus(testMutation);

  const handleSelectDevice = (host: string) => {
    setFroniusHost(host);
    setSearchResults([]);
    searchMutation.reset();
    testMutation.mutate({ host, meterDeviceId: parseInt(meterDeviceId) });
  };

  return (
    <>
      <Text as="p" size="3" color="gray">
        Configure your Fronius inverter's local API connection. Use the search
        feature to auto-discover devices on your network.
      </Text>

      <Text as="p" size="1" color="gray">
        If you're running ChargeHA in a Docker container, it must use host
        networking (<code>--network host</code>) to reach devices on your LAN.
      </Text>

      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Fronius IP Address
        </Text>
        <TextField.Root
          size="2"
          placeholder="192.168.1.50"
          value={froniusHost}
          onChange={(e: { target: { value: string } }) =>
            setFroniusHost(e.target.value)}
          aria-label="Fronius IP Address"
        />
      </div>

      <SearchSection
        subnet={subnet}
        setSubnet={setSubnet}
        searchMutation={searchMutation}
        searchResults={searchResults}
        handleSelectDevice={handleSelectDevice}
      />

      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">
          Meter Device ID
        </Text>
        <Text size="1" color="gray">
          Usually 0 for a single smart meter. Check Fronius Solar.web if you
          have multiple.
        </Text>
        <TextField.Root
          size="2"
          placeholder="0"
          value={meterDeviceId}
          onChange={(e: { target: { value: string } }) =>
            setMeterDeviceId(e.target.value)}
          style={{ width: 80 }}
          aria-label="Meter Device ID"
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!froniusHost || testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              host: froniusHost,
              meterDeviceId: parseInt(meterDeviceId),
            })}
        >
          {testMutation.isPending && <Spinner />}
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>
        <TestResultBadge testResult={testResult} />
      </div>
    </>
  );
}
