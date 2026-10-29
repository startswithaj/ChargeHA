import { useCallback, useState } from "react";
import { Spinner } from "../../../hostUi.ts";
import type { PluginStepDef, WizardNext } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { Powerwall2LocalForm } from "./Powerwall2LocalForm.tsx";
import {
  type Powerwall2LocalValues,
  valuesFrom,
} from "./Powerwall2LocalFields.ts";

const nextState = (
  validated: Powerwall2LocalValues | null,
  save: (values: Powerwall2LocalValues) => Promise<void>,
): WizardNext => {
  if (!validated) {
    return {
      kind: "blocked",
      reason: "Test the Gateway connection to continue",
    };
  }
  return {
    kind: "ready",
    hint: "Next saves the tested Gateway connection",
    onNext: () => save(validated),
  };
};

export const powerwall2LocalSetupStep: PluginStepDef = {
  id: "powerwall2-local-setup",
  label: "Tesla Powerwall 2 via Gateway (Local)",
  useStep: () => {
    const { data } = trpc.plugin.energy.powerwall2_local.getConfig.useQuery();
    const saveMutation = trpc.plugin.energy.powerwall2_local.setConfig
      .useMutation();
    const [validated, setValidated] = useState<Powerwall2LocalValues | null>(
      null,
    );
    const save = useCallback(
      async (values: Powerwall2LocalValues) => {
        await saveMutation.mutateAsync({ ...values });
      },
      [saveMutation],
    );
    if (!data) return { next: nextState(null, save), view: <Spinner /> };
    const initial = valuesFrom(data);
    return {
      next: nextState(validated, save),
      view: (
        <Powerwall2LocalForm
          initial={initial}
          onTestSuccess={setValidated}
        />
      ),
    };
  },
};
