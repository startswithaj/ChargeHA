import { useState } from "react";
import { Badge } from "@radix-ui/themes";
import {
  PluginFieldInputs,
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { OCPP_DEFAULTS, OCPP_FIELDS } from "./fields.ts";
import { OcppConnectionDetails } from "./OcppConnection.tsx";

function ocppNext(connected: boolean): WizardNext {
  if (!connected) {
    return { kind: "blocked", reason: "Waiting for the charger to connect" };
  }
  return { kind: "ready", hint: null, onNext: () => Promise.resolve() };
}

function connectionBadge(
  connected: boolean,
  info: { vendor: string; model: string } | null | undefined,
): JSX.Element {
  if (connected) {
    return (
      <Badge color="green" size="2">
        Connected — {info?.vendor} {info?.model}
      </Badge>
    );
  }
  return <Badge color="gray" size="2">Waiting for charger…</Badge>;
}

export const ocppSetupStep: PluginStepDef = {
  id: "ocpp-setup",
  label: "OCPP Charger",
  useStep: () => {
    const { data: config } = trpc.plugin.charger.ocpp.getConfig.useQuery();
    const utils = trpc.useUtils();
    const saveMutation = trpc.plugin.charger.ocpp.setConfig.useMutation({
      onSuccess: () => utils.plugin.charger.ocpp.getConfig.invalidate(),
    });
    const status = trpc.plugin.charger.ocpp.status.useQuery(undefined, {
      refetchInterval: 2000,
    });
    const [draft, setDraft] = useState<Record<string, string>>({});

    const values = { ...OCPP_DEFAULTS, ...(config ?? {}), ...draft };
    const connected = status.data?.connected === true;

    // Committed on blur, not per keystroke — the id gates the WS route
    // allowlist and half-typed ids must never hit the DB.
    const commit = (key: string) => {
      const value = (draft[key] ?? "").trim();
      if (draft[key] === undefined) return;
      if (value === String((config ?? {})[key] ?? "")) return;
      saveMutation.mutate({ [key]: value });
    };

    return {
      next: ocppNext(connected),
      view: (
        <div className={styles.stepContainer}>
          <PluginFieldInputs
            fields={OCPP_FIELDS}
            values={values}
            onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
            onCommit={commit}
          />
          <OcppConnectionDetails chargerId={values.ocppChargerId} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {connectionBadge(connected, status.data?.info)}
          </div>
        </div>
      ),
    };
  },
};
