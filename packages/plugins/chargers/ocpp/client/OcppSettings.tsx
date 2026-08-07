import { useMemo } from "react";
import { skipToken } from "@tanstack/react-query";
import { Badge } from "@radix-ui/themes";
import { PluginConfigForm, PluginTestRow } from "../../../hostUi.ts";
import type { PluginSettingsProps } from "../../../pluginOptions.ts";
import { trpc } from "./trpc.ts";
import { OCPP_DEFAULTS, OCPP_FIELDS } from "./fields.ts";
import { OcppConnectBlock } from "./OcppConnection.tsx";

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

export function OcppSettings(
  { chargerId }: PluginSettingsProps,
): JSX.Element | null {
  const rowId = chargerId ?? null;
  const configQuery = trpc.plugin.charger.ocpp.getConfig.useQuery(
    rowId === null ? skipToken : { chargerRowId: rowId },
  );
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.charger.ocpp.setConfig.useMutation({
    onSuccess: (data) => {
      // The charger list itself (add mode's new row included) is kept fresh
      // by the chargers_changed SSE event server-side rebuild emits.
      utils.plugin.charger.ocpp.getConfig.invalidate({
        chargerRowId: data.chargerRowId,
      });
    },
  });
  // Pairing sits under the Charger ID row so "Use this ID" is beside the field
  // it fills; `after` is what hands us the setter.
  // Charger ID is discovered in the connect block above, not typed in a row.
  const fields = useMemo(
    () => OCPP_FIELDS.filter((f) => f.key !== "ocppChargerId"),
    [],
  );
  const status = trpc.plugin.charger.ocpp.status.useQuery(
    rowId === null ? skipToken : { chargerRowId: rowId },
    { refetchInterval: 5000 },
  );

  // No row yet in add mode — show the field defaults; setConfig creates the
  // row on save.
  const config = rowId === null ? OCPP_DEFAULTS : configQuery.data;
  if (!config) return null;

  return (
    <PluginConfigForm
      data={config}
      fields={fields}
      onSave={(draft, opts) =>
        configMutation.mutate({ chargerRowId: rowId, values: draft }, opts)}
      renderHeader={(values, setValue) => (
        <OcppConnectBlock
          chargerId={values.ocppChargerId ?? ""}
          connected={rowId === null ? null : status.data?.connected ?? false}
          info={rowId === null ? null : status.data?.info ?? null}
          onDetected={(id) => setValue("ocppChargerId", id)}
        />
      )}
      renderFooter={(values) => (
        <ConnectionRow
          chargerId={values.ocppChargerId ?? ""}
          chargerRowId={rowId}
          status={status.data}
        />
      )}
    />
  );
}

function ConnectionRow(
  { chargerId, chargerRowId, status }: {
    chargerId: string;
    chargerRowId: string | null;
    status: OcppStatus;
  },
) {
  const test = trpc.plugin.charger.ocpp.testConnection.useMutation();
  const result = test.data;
  // Without an id there is no route for the charger to have connected to, so
  // the test can only ever fail — say why rather than reporting a timeout.
  const missingId = chargerId.trim() === "" || chargerRowId === null;

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
      onTest={() => chargerRowId !== null && test.mutate({ chargerRowId })}
    />
  );
}
