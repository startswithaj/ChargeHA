import { useMemo, useState } from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import { Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import type { TestStatus } from "../../InverterSetupShared.tsx";
import { TestResultBadge } from "../../InverterSetupShared.tsx";

export interface SigenergyFormValues {
  host: string;
  port: string;
  plantUnitId: string;
  deviceUnitId: string;
}

interface SigenergyFormProps {
  initial: SigenergyFormValues;
  onTestSuccess: (values: SigenergyFormValues) => void;
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

function useTestStatus(
  testMutation: ReturnType<
    typeof trpc.energy.sigenergy.testConnection.useMutation
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

export function SigenergyForm(
  { initial, onTestSuccess }: SigenergyFormProps,
): JSX.Element {
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port || "502");
  const [plantUnitId, setPlantUnitId] = useState(initial.plantUnitId || "247");
  const [deviceUnitId, setDeviceUnitId] = useState(
    initial.deviceUnitId || "1",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const testMutation = trpc.energy.sigenergy.testConnection.useMutation({
    onSuccess: (data: { success: boolean }) => {
      if (data.success) {
        onTestSuccess({ host, port, plantUnitId, deviceUnitId });
      }
    },
  });

  const testResult = useTestStatus(testMutation);

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

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!host || testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              host,
              port: parseInt(port || "502", 10),
              plantUnitId: parseInt(plantUnitId || "247", 10),
              deviceUnitId: parseInt(deviceUnitId || "1", 10),
            })}
        >
          {testMutation.isPending && (
            <Loader2 size={14} className={styles.spinner} />
          )}
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>
        <TestResultBadge testResult={testResult} />
      </div>
    </>
  );
}
