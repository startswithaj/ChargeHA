import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import {
  SettingsRow,
  usePluginSettingsHost,
  useSaveStatus,
} from "../../../hostUi.ts";

interface SigenergyLocalConfigValues {
  host: string;
  port: string;
  plantUnitId: string;
  deviceUnitId: string;
}

type SigenergyDraft = Partial<SigenergyLocalConfigValues>;

// Buffered like FroniusLocalConfig: a write per keystroke would rebuild the
// energy adapter — and reopen the Modbus TCP connection — against every
// half-typed host (config_changed → poller).
function useSigenergyDraft(config: SigenergyLocalConfigValues | undefined) {
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.sigenergy_local.setConfig
    .useMutation({
      onSuccess: () =>
        utils.plugin.energy.sigenergy_local.getConfig.invalidate(),
    });
  const [draft, setDraft] = useState<SigenergyDraft>({});
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();

  const host = draft.host ?? config?.host ?? "";
  const port = draft.port ?? config?.port ?? "";
  const plantUnitId = draft.plantUnitId ?? config?.plantUnitId ?? "";
  const deviceUnitId = draft.deviceUnitId ?? config?.deviceUnitId ?? "";
  const isDirty = Object.keys(draft).length > 0;

  const save = useCallback(() => {
    if (!isDirty) return;
    onMutate();
    configMutation.mutate({ host, port, plantUnitId, deviceUnitId }, {
      onSuccess: () => {
        onSuccess();
        setDraft({});
      },
      onError,
    });
  }, [
    isDirty,
    host,
    port,
    plantUnitId,
    deviceUnitId,
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

  return { host, port, plantUnitId, deviceUnitId, setDraft };
}

function RealtimePreview(
  { realtime }: {
    realtime?: {
      solarProductionW: number;
      homeConsumptionW: number;
      gridPowerW: number;
    };
  },
) {
  if (!realtime) return null;
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        background: "var(--green-a2)",
      }}
    >
      <Text size="1" color="gray">
        Solar: {(realtime.solarProductionW / 1000).toFixed(1)} kW
        {" / "}
        Home: {(realtime.homeConsumptionW / 1000).toFixed(1)} kW
        {" / "}
        Grid: {(realtime.gridPowerW / 1000).toFixed(1)} kW
      </Text>
    </div>
  );
}

export function SigenergyLocalConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.sigenergy_local.getConfig
    .useQuery();
  const testMutation = trpc.plugin.energy.sigenergy_local.testConnection
    .useMutation();

  const { host, port, plantUnitId, deviceUnitId, setDraft } = useSigenergyDraft(
    config as SigenergyLocalConfigValues | undefined,
  );

  if (!config) return null;

  const testSuccess = testMutation.isSuccess && testMutation.data.success
    ? testMutation.data
    : null;

  return (
    <>
      <SettingsRow
        label="Sigenergy IP address"
        help="Local IP or hostname of your Sigenergy inverter (Modbus TCP)."
      >
        <TextField.Root
          size="2"
          placeholder="192.168.1.50"
          value={host}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, host: e.target.value }))}
          style={{ width: 150 }}
        />
      </SettingsRow>

      <SettingsRow label="Modbus TCP port" help="Default 502.">
        <TextField.Root
          size="2"
          placeholder="502"
          value={port}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, port: e.target.value }))}
          style={{ width: 80 }}
        />
      </SettingsRow>

      <SettingsRow
        label="Plant unit ID"
        help="Modbus unit id for plant/EMS registers. Default 247."
      >
        <TextField.Root
          size="2"
          placeholder="247"
          value={plantUnitId}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, plantUnitId: e.target.value }))}
          style={{ width: 80 }}
        />
      </SettingsRow>

      <SettingsRow
        label="Device unit ID"
        help="Modbus unit id for per-device registers. Default 1."
      >
        <TextField.Root
          size="2"
          placeholder="1"
          value={deviceUnitId}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, deviceUnitId: e.target.value }))}
          style={{ width: 80 }}
        />
      </SettingsRow>

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
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>

        {testSuccess?.device && (
          <Badge color="green" size="2">
            Connected — {testSuccess.device.name}
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

      <RealtimePreview realtime={testSuccess?.realtime} />
    </>
  );
}
