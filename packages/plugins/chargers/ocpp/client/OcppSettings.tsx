import { Badge, Button, Code, Text } from "@radix-ui/themes";
import {
  type PluginConfigField,
  PluginConfigForm,
  SettingsRow,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

const FIELDS: PluginConfigField[] = [
  {
    key: "ocppChargerId",
    label: "Charger ID",
    help: "Path component of the charger URL. Letters, numbers, dots, " +
      "dashes and underscores only.",
    width: 180,
  },
  {
    key: "ocppMaxAmps",
    label: "Max amps",
    help: "The charger's maximum charging current.",
    width: 80,
  },
  {
    key: "ocppMinAmps",
    label: "Min amps",
    help: "The charger's minimum charging current (J1772 floor is 6A).",
    width: 80,
  },
  {
    key: "ocppPhases",
    label: "Phases",
    help: "Used to derive amps from reported watts when the charger does " +
      "not report current.",
    options: [
      { value: "1", label: "Single phase" },
      { value: "3", label: "Three phase" },
    ],
  },
  {
    key: "ocppMeterTimeoutSeconds",
    label: "Meter timeout (seconds)",
    help: "Reported state goes stale when no MeterValues arrive within this.",
    width: 80,
  },
];

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

  const wsUrl = `ws://${globalThis.location.hostname}${
    globalThis.location.port ? `:${globalThis.location.port}` : ""
  }${status.data?.wsPath ?? ""}`;

  return (
    <>
      <PluginConfigForm
        data={config}
        fields={FIELDS}
        onSave={(draft, opts) => configMutation.mutate(draft, opts)}
      />
      <SettingsRow
        label="Charger URL"
        help="Enter this in your charger's OCPP settings. The charger connects to ChargeHA over your LAN."
      >
        <Code size="2">{wsUrl}</Code>
      </SettingsRow>
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
