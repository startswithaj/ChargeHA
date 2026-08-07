import { skipToken } from "@tanstack/react-query";
import { PluginConfigForm } from "../../../hostUi.ts";
import type { PluginSettingsProps } from "../../../pluginOptions.ts";
import { trpc } from "./trpc.ts";
import { TAPO_DEFAULTS, TAPO_FIELDS } from "./fields.tsx";
import { TapoTestButton } from "./TapoControls.tsx";

export { TapoDiscoverySection, TapoTestButton } from "./TapoControls.tsx";

export function TapoSettings(
  { chargerId }: PluginSettingsProps,
): JSX.Element | null {
  const rowId = chargerId ?? null;
  const configQuery = trpc.plugin.charger.tapo.getConfig.useQuery(
    rowId === null ? skipToken : { chargerRowId: rowId },
  );
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.charger.tapo.setConfig.useMutation({
    onSuccess: (data) => {
      // The charger list itself (add mode's new row included) is kept fresh
      // by the chargers_changed SSE event server-side rebuild emits.
      utils.plugin.charger.tapo.getConfig.invalidate({
        chargerRowId: data.chargerRowId,
      });
    },
  });

  // No row yet in add mode — show the field defaults; setConfig creates the
  // row on save.
  const config = rowId === null ? TAPO_DEFAULTS : configQuery.data;
  if (!config) return null;

  return (
    <PluginConfigForm
      data={config}
      fields={TAPO_FIELDS}
      onSave={(draft, opts) =>
        configMutation.mutate({ chargerRowId: rowId, values: draft }, opts)}
      renderFooter={(values) => (
        <TapoTestButton
          host={values.tapoHost}
          email={values.tapoEmail}
          password={values.tapoPassword}
        />
      )}
    />
  );
}
