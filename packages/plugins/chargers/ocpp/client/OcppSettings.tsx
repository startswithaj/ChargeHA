import { Badge, Code, Text } from "@radix-ui/themes";
import { SettingsRow } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

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
  const status = trpc.plugin.charger.ocpp.status.useQuery(undefined, {
    refetchInterval: 5000,
  });

  if (!config) return null;

  const wsUrl = `ws://${globalThis.location.hostname}${
    globalThis.location.port ? `:${globalThis.location.port}` : ""
  }${status.data?.wsPath ?? ""}`;

  return (
    <>
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
    </>
  );
}
