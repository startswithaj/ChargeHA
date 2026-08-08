import { useMemo, useState } from "react";
import { Button, Code, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import {
  NetworkDeviceSearch,
  Spinner,
  useDefaultSubnet,
} from "../../../hostUi.ts";
import { stepStyles as styles } from "../../../hostUi.ts";
import { TestResultBadge, type TestStatus } from "../../../hostUi.ts";
import type { FroniusDevice } from "../../InverterSetupShared.tsx";

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
  {
    subnet,
    setSubnet,
    detectedSubnets,
    searchMutation,
    searchResults,
    handleSelectDevice,
  }: {
    subnet: string;
    setSubnet: (v: string) => void;
    detectedSubnets?: string[];
    searchMutation: ReturnType<
      typeof trpc.plugin.energy.fronius_local.discover.useMutation
    >;
    searchResults: FroniusDevice[];
    handleSelectDevice: (host: string) => void;
  },
) {
  return (
    <>
      <NetworkDeviceSearch
        deviceNoun="Fronius inverters"
        subnet={subnet}
        onSubnetChange={setSubnet}
        detectedSubnets={detectedSubnets}
        onSearch={() => searchMutation.mutate({ subnet: subnet || undefined })}
        isPending={searchMutation.isPending}
        searched={searchMutation.isSuccess}
        results={searchResults}
        onUse={(d) => handleSelectDevice(d.host)}
        emptyMessage={
          <>
            No Fronius inverters found. Try entering your subnet above (check
            your router settings or run <Code size="1">ifconfig</Code>).
          </>
        }
      />
    </>
  );
}

/** Search state + the subnet default, split out to keep FroniusLocalForm
 *  under the function-length limit. */
function useFroniusSearch() {
  const [subnet, setSubnet] = useState("");
  const [searchResults, setSearchResults] = useState<FroniusDevice[]>([]);

  // Defaults the subnet field to where ChargeHA itself is reachable, once,
  // while still leaving it fully editable.
  const lanSubnets = trpc.plugin.energy.fronius_local.lanSubnets.useQuery();
  useDefaultSubnet(lanSubnets.data, subnet, setSubnet);

  const searchMutation = trpc.plugin.energy.fronius_local.discover.useMutation({
    onSuccess: (result: { found: FroniusDevice[] }) =>
      setSearchResults(result.found),
    onError: () => setSearchResults([]),
  });

  return {
    subnet,
    setSubnet,
    lanSubnets,
    searchMutation,
    searchResults,
    setSearchResults,
  };
}

export function FroniusLocalForm({
  initialHost,
  initialMeterDeviceId,
  onTestSuccess,
}: FroniusLocalFormProps): JSX.Element {
  const [froniusHost, setFroniusHost] = useState(initialHost);
  const [meterDeviceId, setMeterDeviceId] = useState(initialMeterDeviceId);
  const {
    subnet,
    setSubnet,
    lanSubnets,
    searchMutation,
    searchResults,
    setSearchResults,
  } = useFroniusSearch();

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
        detectedSubnets={lanSubnets.data}
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
