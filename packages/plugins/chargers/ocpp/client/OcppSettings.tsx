import { useMemo } from "react";
import { skipToken } from "@tanstack/react-query";
import { Button, Flex, Text } from "@radix-ui/themes";
import { PluginConfigForm } from "../../../hostUi.ts";
import type { PluginSettingsProps } from "../../../pluginOptions.ts";
import { trpc } from "./trpc.ts";
import { OCPP_DEFAULTS, OCPP_FIELDS } from "./fields.ts";
import { OcppConnectBlock } from "./OcppConnection.tsx";

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
      renderFooter={() =>
        rowId === null ? null : <OcppRecoveryBlock rowId={rowId} />}
    />
  );
}

function OcppRecoveryBlock({ rowId }: { rowId: string }): JSX.Element {
  const recover = trpc.plugin.charger.ocpp.recoverConnection.useMutation();
  const reset = trpc.plugin.charger.ocpp.softReset.useMutation();
  return (
    <Flex direction="column" gap="2">
      <Text size="2" color="gray">
        Stuck charger? Recover clears cached state and stored charging profiles,
        then re-syncs. Soft reset reboots the charger remotely.
      </Text>
      <Flex gap="2">
        <Button
          type="button"
          variant="soft"
          disabled={recover.isPending}
          onClick={() => recover.mutate({ chargerRowId: rowId })}
        >
          Recover connection
        </Button>
        <Button
          type="button"
          variant="soft"
          color="amber"
          disabled={reset.isPending}
          onClick={() => reset.mutate({ chargerRowId: rowId })}
        >
          Soft reset charger
        </Button>
      </Flex>
      {recover.data && (
        <Text size="1" color="gray">{recover.data.steps.join(" · ")}</Text>
      )}
      {reset.data && (
        <Text size="1" color="gray">
          Reset {reset.data.accepted ? "accepted" : "rejected"}
        </Text>
      )}
    </Flex>
  );
}
