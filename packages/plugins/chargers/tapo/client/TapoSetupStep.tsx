import { useState } from "react";
import { Text, TextField } from "@radix-ui/themes";
import {
  type PluginStepDef,
  SettingsRow,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { TapoDiscoverySection, TapoTestButton } from "./TapoSettings.tsx";

interface TapoForm {
  host: string;
  email: string;
  password: string;
  fixedDrawAmps: string;
}

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
  label: "Tapo Smart Plug",
  useStep: () => {
    const saveMutation = trpc.plugin.charger.tapo.setConfig.useMutation();
    const [form, setForm] = useState<TapoForm>({
      host: "",
      email: "",
      password: "",
      fixedDrawAmps: "10",
    });
    const [validated, setValidated] = useState(false);

    const patch = (delta: Partial<TapoForm>) => {
      setForm((f) => ({ ...f, ...delta }));
      setValidated(false);
    };

    const save = async () => {
      await saveMutation.mutateAsync({
        tapoHost: form.host,
        tapoEmail: form.email,
        tapoPassword: form.password,
        tapoFixedDrawAmps: form.fixedDrawAmps,
      });
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
          <TapoDiscoverySection
            onUse={(host) => patch({ host })}
          />
          <SettingsRow label="Plug IP address">
            <TextField.Root
              size="2"
              placeholder="192.168.1.60"
              value={form.host}
              onChange={(e: { target: { value: string } }) =>
                patch({ host: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow label="Tapo account email">
            <TextField.Root
              size="2"
              value={form.email}
              onChange={(e: { target: { value: string } }) =>
                patch({ email: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow label="Tapo account password">
            <TextField.Root
              size="2"
              type="password"
              value={form.password}
              onChange={(e: { target: { value: string } }) =>
                patch({ password: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow
            label="EVSE draw (amps)"
            help="The current your EVSE draws from this socket (e.g. 10A for an AU 10A socket). The plug's continuous rating must be at or above this."
          >
            <TextField.Root
              size="2"
              value={form.fixedDrawAmps}
              onChange={(e: { target: { value: string } }) =>
                patch({ fixedDrawAmps: e.target.value })}
              style={{ width: 80 }}
            />
          </SettingsRow>
          <TapoTestButton
            host={form.host}
            email={form.email}
            password={form.password}
            onValidated={() => setValidated(true)}
          />
        </div>
      ),
    };
  },
};
