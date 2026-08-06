import { Badge, Button, Text } from "@radix-ui/themes";
import { PluginConfigForm, SettingsRow } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { OCPP_FIELDS } from "./fields.ts";
import { OcppConnectionDetails } from "./OcppConnection.tsx";

function connectionBadge(
  data: {
    connected: boolean;
    info: { vendor: string; model: string; firmwareVersion: string } | null;
  } | undefined,
): JSX.Element {
  if (data?.connected) {
    return (
      <Badge color="green" size="2">
        Connected — {data.info?.vendor} {data.info?.model} (fw{" "}
        {data.info?.firmwareVersion})
      </Badge>
    );
  }
  return <Badge color="red" size="2">Disconnected</Badge>;
}

export function OcppSettings(): JSX.Element | null {
  const { data: config } = trpc.plugin.charger.ocpp.getConfig.useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.charger.ocpp.setConfig.useMutation({
    onSuccess: () => utils.plugin.charger.ocpp.getConfig.invalidate(),
  });
  const status = trpc.plugin.charger.ocpp.status.useQuery(undefined, {
    refetchInterval: 5000,
  });

  if (!config) return null;

  return (
    <>
      <PluginConfigForm
        data={config}
        fields={OCPP_FIELDS}
        onSave={(draft, opts) => configMutation.mutate(draft, opts)}
        renderFooter={(values) => (
          <OcppConnectionDetails chargerId={values.ocppChargerId} />
        )}
      />
      <SettingsRow label="Connection">
        {connectionBadge(status.data)}
      </SettingsRow>
      {status.data?.status && (
        <SettingsRow label="Charger status">
          <Text size="2">{status.data.status}</Text>
        </SettingsRow>
      )}
      <OcppTestButton />
    </>
  );
}

function OcppTestButton(): JSX.Element {
  const test = trpc.plugin.charger.ocpp.testConnection.useMutation();
  const result = test.data;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button
        size="2"
        variant="soft"
        disabled={test.isPending}
        onClick={() => test.mutate()}
      >
        {test.isPending ? "Testing..." : "Test Connection"}
      </Button>
      {result?.success === true && (
        <Badge color="green" size="1">
          Responding ({result.latencyMs} ms)
        </Badge>
      )}
      {result?.success === false && (
        <Text size="2" color="red">{result.error}</Text>
      )}
    </div>
  );
}
