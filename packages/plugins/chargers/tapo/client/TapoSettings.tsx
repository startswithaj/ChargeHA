import { PluginConfigForm } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { TAPO_FIELDS } from "./fields.tsx";
import { TapoTestButton } from "./TapoControls.tsx";

export { TapoDiscoverySection, TapoTestButton } from "./TapoControls.tsx";

export function TapoSettings(): JSX.Element | null {
  const { data: config } = trpc.plugin.charger.tapo.getConfig.useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.charger.tapo.setConfig.useMutation({
    onSuccess: () => utils.plugin.charger.tapo.getConfig.invalidate(),
  });

  if (!config) return null;

  return (
    <PluginConfigForm
      data={config}
      fields={TAPO_FIELDS}
      onSave={(draft, opts) => configMutation.mutate(draft, opts)}
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
