import { useMemo, useState } from "react";
import { Button, Code, Text, TextField } from "@radix-ui/themes";
import { Loader2, Search } from "lucide-react";
import { trpc } from "./trpc.ts";
import { Spinner } from "../../../../client/src/components/ui/Spinner.tsx";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import type {
  SigenergyDevice,
  TestStatus,
} from "../../InverterSetupShared.tsx";
import { TestResultBadge } from "../../InverterSetupShared.tsx";

export interface SigenergyLocalFormValues {
  host: string;
  port: string;
  plantUnitId: string;
  deviceUnitId: string;
}

interface SigenergyLocalFormProps {
  initial: SigenergyLocalFormValues;
  onTestSuccess: (values: SigenergyLocalFormValues) => void;
}

function AdvancedFields(
  {
    port,
    setPort,
    plantUnitId,
    setPlantUnitId,
    deviceUnitId,
    setDeviceUnitId,
  }: {
    port: string;
    setPort: (v: string) => void;
    plantUnitId: string;
    setPlantUnitId: (v: string) => void;
    deviceUnitId: string;
    setDeviceUnitId: (v: string) => void;
  },
) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Modbus TCP port</Text>
        <TextField.Root
          size="2"
          placeholder="502"
          value={port}
          onChange={(e: { target: { value: string } }) =>
            setPort(e.target.value)}
          style={{ width: 100 }}
          aria-label="Modbus TCP port"
        />
      </div>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Plant unit ID</Text>
        <Text size="1" color="gray">
          Modbus unit id for plant/EMS registers. Default 247.
        </Text>
        <TextField.Root
          size="2"
          placeholder="247"
          value={plantUnitId}
          onChange={(e: { target: { value: string } }) =>
            setPlantUnitId(e.target.value)}
          style={{ width: 100 }}
          aria-label="Plant unit ID"
        />
      </div>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Device unit ID</Text>
        <Text size="1" color="gray">
          Modbus unit id for per-device registers. Default 1.
        </Text>
        <TextField.Root
          size="2"
          placeholder="1"
          value={deviceUnitId}
          onChange={(e: { target: { value: string } }) =>
            setDeviceUnitId(e.target.value)}
          style={{ width: 100 }}
          aria-label="Device unit ID"
        />
      </div>
    </>
  );
}

function SearchSection(
  { subnet, setSubnet, searchMutation, searchResults, onSelectDevice }: {
    subnet: string;
    setSubnet: (v: string) => void;
    searchMutation: ReturnType<
      typeof trpc.plugin.energy.sigenergy_local.discover.useMutation
    >;
    searchResults: SigenergyDevice[];
    onSelectDevice: (host: string) => void;
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
          for Sigenergy devices...
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
                onClick={() => onSelectDevice(d.host)}
              >
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
      {searchMutation.isSuccess && searchResults.length === 0 && (
        <Text size="2" color="orange">
          No Sigenergy devices found. Try entering your subnet above (check your
          router settings or run <Code size="1">ifconfig</Code>).
        </Text>
      )}
    </>
  );
}

function useTestStatus(
  testMutation: ReturnType<
    typeof trpc.plugin.energy.sigenergy_local.testConnection.useMutation
  >,
): TestStatus {
  return useMemo(() => {
    if (testMutation.isPending) return { status: "testing" };
    if (testMutation.isSuccess && testMutation.data.success) {
      return { status: "success", detail: testMutation.data.device?.name };
    }
    if (testMutation.isSuccess && !testMutation.data.success) {
      return {
        status: "error",
        message: testMutation.data.error ?? "Connection failed",
      };
    }
    if (testMutation.isError) {
      return { status: "error", message: testMutation.error.message };
    }
    return { status: "idle" };
  }, [
    testMutation.isPending,
    testMutation.isSuccess,
    testMutation.isError,
    testMutation.data,
    testMutation.error,
  ]);
}

type TestVariables = {
  host: string;
  port?: number;
  plantUnitId?: number;
  deviceUnitId?: number;
};

/** Build the test-connection mutation input from the form's string fields. */
function testArgs(values: SigenergyLocalFormValues) {
  return {
    host: values.host,
    port: parseInt(values.port || "502", 10),
    plantUnitId: parseInt(values.plantUnitId || "247", 10),
    deviceUnitId: parseInt(values.deviceUnitId || "1", 10),
  };
}

/** On a successful test, echo the validated values (as strings) upward. */
const onTestSuccessHandler =
  (onTestSuccess: (values: SigenergyLocalFormValues) => void) =>
  (data: { success: boolean }, variables: TestVariables) => {
    if (!data.success) return;
    onTestSuccess({
      host: variables.host,
      port: String(variables.port ?? 502),
      plantUnitId: String(variables.plantUnitId ?? 247),
      deviceUnitId: String(variables.deviceUnitId ?? 1),
    });
  };

function TestConnectionRow(
  { disabled, isPending, testResult, onTest }: {
    disabled: boolean;
    isPending: boolean;
    testResult: TestStatus;
    onTest: () => void;
  },
) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button size="2" variant="soft" disabled={disabled} onClick={onTest}>
        {isPending && <Loader2 size={14} className={styles.spinner} />}
        {isPending ? "Testing..." : "Test Connection"}
      </Button>
      <TestResultBadge testResult={testResult} />
    </div>
  );
}

export function SigenergyLocalForm(
  { initial, onTestSuccess }: SigenergyLocalFormProps,
): JSX.Element {
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port || "502");
  const [plantUnitId, setPlantUnitId] = useState(initial.plantUnitId || "247");
  const [deviceUnitId, setDeviceUnitId] = useState(
    initial.deviceUnitId || "1",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [subnet, setSubnet] = useState(() => {
    // Auto-detect subnet from browser hostname if it's an IP address.
    const hostname = globalThis.location?.hostname ?? "";
    const match = hostname.match(/^(\d+\.\d+\.\d+)\.\d+$/);
    return match ? match[1] : "";
  });
  const [searchResults, setSearchResults] = useState<SigenergyDevice[]>([]);

  const searchMutation = trpc.plugin.energy.sigenergy_local.discover
    .useMutation({
      onSuccess: (result: { found: SigenergyDevice[] }) =>
        setSearchResults(result.found),
      onError: () => setSearchResults([]),
    });

  const testMutation = trpc.plugin.energy.sigenergy_local.testConnection
    .useMutation({
      onSuccess: onTestSuccessHandler(onTestSuccess),
    });

  const testResult = useTestStatus(testMutation);

  const handleSelectDevice = (selectedHost: string) => {
    setHost(selectedHost);
    setSearchResults([]);
    searchMutation.reset();
    testMutation.mutate(
      testArgs({ host: selectedHost, port, plantUnitId, deviceUnitId }),
    );
  };

  return (
    <>
      <Text as="p" size="3" color="gray">
        Connect to your Sigenergy inverter over Modbus TCP on your local
        network. Enter the inverter's IP address (or hostname) below.
      </Text>

      <Text as="p" size="1" color="gray">
        If you're running ChargeHA in a Docker container, it must use host
        networking (<code>--network host</code>) to reach devices on your LAN.
      </Text>

      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Sigenergy IP address</Text>
        <TextField.Root
          size="2"
          placeholder="192.168.1.50"
          value={host}
          onChange={(e: { target: { value: string } }) =>
            setHost(e.target.value)}
          aria-label="Sigenergy IP address"
        />
      </div>

      <SearchSection
        subnet={subnet}
        setSubnet={setSubnet}
        searchMutation={searchMutation}
        searchResults={searchResults}
        onSelectDevice={handleSelectDevice}
      />

      <Button
        size="1"
        variant="ghost"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide advanced settings" : "Advanced settings"}
      </Button>

      {showAdvanced && (
        <AdvancedFields
          port={port}
          setPort={setPort}
          plantUnitId={plantUnitId}
          setPlantUnitId={setPlantUnitId}
          deviceUnitId={deviceUnitId}
          setDeviceUnitId={setDeviceUnitId}
        />
      )}

      <TestConnectionRow
        disabled={!host || testMutation.isPending}
        isPending={testMutation.isPending}
        testResult={testResult}
        onTest={() =>
          testMutation.mutate(
            testArgs({ host, port, plantUnitId, deviceUnitId }),
          )}
      />
    </>
  );
}
