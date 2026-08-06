import { Badge } from "@radix-ui/themes";
import { PluginConfigForm, PluginTestRow } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { OCPP_FIELDS } from "./fields.ts";
import { OcppConnectionDetails } from "./OcppConnection.tsx";

type OcppStatus = {
  connected: boolean;
  status: string | null;
  info: { vendor: string; model: string; firmwareVersion: string } | null;
} | undefined;

function connectionBadge(data: OcppStatus): JSX.Element {
  if (data?.connected) {
    return <Badge color="green" size="2">Connected</Badge>;
  }
  return <Badge color="red" size="2">Disconnected</Badge>;
}

/** Live charger identity, only knowable once it has connected. */
function chargerDetail(data: OcppStatus): string | null {
  if (!data?.connected) return null;
  const parts = [data.info?.vendor, data.info?.model, data.status]
    .filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : null;
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
    <PluginConfigForm
      data={config}
      fields={OCPP_FIELDS}
      onSave={(draft, opts) => configMutation.mutate(draft, opts)}
      renderFooter={(values) => (
        <>
          <OcppConnectionDetails chargerId={values.ocppChargerId} />
          <ConnectionRow
            chargerId={values.ocppChargerId}
            status={status.data}
          />
        </>
      )}
    />
  );
}

function ConnectionRow(
  { chargerId, status }: { chargerId: string; status: OcppStatus },
) {
  const test = trpc.plugin.charger.ocpp.testConnection.useMutation();
  const result = test.data;
  // Without an id there is no route for the charger to have connected to, so
  // the test can only ever fail — say why rather than reporting a timeout.
  const missingId = chargerId.trim() === "";

  const message = (() => {
    if (missingId) return "Enter a Charger ID above before testing.";
    if (result?.success === false) return result.error;
    if (result?.success === true) return `Responding in ${result.latencyMs} ms`;
    return chargerDetail(status);
  })();

  return (
    <PluginTestRow
      pending={test.isPending}
      disabled={missingId}
      status={connectionBadge(status)}
      message={message}
      tone={missingId || result?.success === false ? "red" : "gray"}
      onTest={() => test.mutate()}
    />
  );
}
