import { useState } from "react";
import { Text } from "@radix-ui/themes";
import {
  PluginFieldInputs,
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { TAPO_DEFAULTS, TAPO_FIELDS } from "./fields.tsx";
import { TapoTestButton } from "./TapoControls.tsx";

function tapoNext(
  validated: boolean,
  save: () => Promise<void>,
): WizardNext {
  if (!validated) {
    return { kind: "blocked", reason: "Test the connection to continue" };
  }
  return {
    kind: "ready",
    hint: "Next saves your Tapo settings",
    onNext: save,
  };
}

export const tapoSetupStep: PluginStepDef = {
  id: "tapo-setup",
  label: "Tapo P110/115 Smart Plug",
  useStep: ({ chargerId, setChargerId }) => {
    const saveMutation = trpc.plugin.charger.tapo.setConfig.useMutation();
    const [form, setForm] = useState<Record<string, string>>(TAPO_DEFAULTS);
    const [validated, setValidated] = useState(false);

    const patch = (key: string, value: string) => {
      setForm((f) => ({ ...f, [key]: value }));
      setValidated(false);
    };

    // One save, on Next — nothing is written while the user is still typing.
    const save = async () => {
      const result = await saveMutation.mutateAsync({
        chargerRowId: chargerId,
        values: form,
      });
      setChargerId(result.chargerRowId);
    };

    return {
      next: tapoNext(validated, save),
      view: (
        <div className={styles.stepContainer}>
          <Text size="2">
            ChargeHA switches the plug on and off to follow your solar. Your
            Tapo account credentials never leave this server — they are only
            used to talk to the plug locally.
          </Text>
          <PluginFieldInputs
            fields={TAPO_FIELDS}
            values={form}
            onChange={patch}
          />
          <TapoTestButton
            host={form.tapoHost}
            email={form.tapoEmail}
            password={form.tapoPassword}
            onValidated={() => setValidated(true)}
          />
        </div>
      ),
    };
  },
};
