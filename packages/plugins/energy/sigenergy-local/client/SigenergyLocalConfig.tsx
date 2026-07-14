import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../../client/src/components/pages/Settings/SettingsLayout.tsx";

interface SigenergyLocalConfigValues {
  host: string;
  port: string;
  plantUnitId: string;
  deviceUnitId: string;
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
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.sigenergy_local.setConfig
    .useMutation({
      onSuccess: () =>
        utils.plugin.energy.sigenergy_local.getConfig.invalidate(),
    });
  const testMutation = trpc.plugin.energy.sigenergy_local.testConnection
    .useMutation();

  if (!config) return null;

  const cfg = config as SigenergyLocalConfigValues;
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
          value={cfg.host}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ host: e.target.value })}
          style={{ width: 150 }}
        />
      </SettingsRow>

      <SettingsRow label="Modbus TCP port" help="Default 502.">
        <TextField.Root
          size="2"
          placeholder="502"
          value={cfg.port}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ port: e.target.value })}
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
          value={cfg.plantUnitId}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ plantUnitId: e.target.value })}
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
          value={cfg.deviceUnitId}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ deviceUnitId: e.target.value })}
          style={{ width: 80 }}
        />
      </SettingsRow>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!cfg.host || testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              host: cfg.host,
              port: parseInt(cfg.port || "502", 10),
              plantUnitId: parseInt(cfg.plantUnitId || "247", 10),
              deviceUnitId: parseInt(cfg.deviceUnitId || "1", 10),
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
