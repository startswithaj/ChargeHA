import { PluginConfigForm } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import {
  POWERWALL2_LOCAL_FIELDS,
  valuesFrom,
} from "./Powerwall2LocalFields.ts";
import { Powerwall2LocalTestResult } from "./Powerwall2LocalView.tsx";

function ConnectionTest({ values }: { values: Record<string, string> }) {
  const input = valuesFrom(values);
  const test = trpc.plugin.energy.powerwall2_local.testConnection
    .useMutation();
  const tested: Record<string, string> | undefined = test.variables;
  const current = Object.entries(input).every(([key, value]) =>
    tested?.[key] === value
  );
  return (
    <Powerwall2LocalTestResult
      pending={test.isPending}
      disabled={!input.host || !input.password}
      onTest={() => test.mutate(input)}
      result={current && test.isSuccess ? test.data : undefined}
      error={current && test.isError ? test.error.message : undefined}
    />
  );
}

export function Powerwall2LocalConfig(): JSX.Element {
  const { data } = trpc.plugin.energy.powerwall2_local.getConfig.useQuery();
  const utils = trpc.useUtils();
  const { mutate } = trpc.plugin.energy.powerwall2_local.setConfig.useMutation(
    {
      onSuccess: () =>
        utils.plugin.energy.powerwall2_local.getConfig.invalidate(),
    },
  );
  return (
    <PluginConfigForm
      data={data}
      fields={POWERWALL2_LOCAL_FIELDS}
      onSave={mutate}
      renderFooter={(values) => <ConnectionTest values={values} />}
    />
  );
}
