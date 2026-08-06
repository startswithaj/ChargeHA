import { useMemo, useState } from "react";
import {
  PluginFieldInputs,
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { OCPP_DEFAULTS, OCPP_FIELDS } from "./fields.ts";
import { OcppConnectBlock } from "./OcppConnection.tsx";

function ocppNext(connected: boolean): WizardNext {
  if (!connected) {
    return { kind: "blocked", reason: "Waiting for the charger to connect" };
  }
  return { kind: "ready", hint: null, onNext: () => Promise.resolve() };
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
    const promote = trpc.plugin.charger.ocpp.promotePairing.useMutation();
    const [draft, setDraft] = useState<Record<string, string>>({});
    // Same pairing affordance as the settings panel, so first-run and later
    // edits behave identically.
    const fields = useMemo(
      () => OCPP_FIELDS.filter((f) => f.key !== "ocppChargerId"),
      [],
    );

    const values = { ...OCPP_DEFAULTS, ...(config ?? {}), ...draft };
    const connected = status.data?.connected === true;

    // Committed on blur, not per keystroke — the id gates the WS route
    // allowlist and half-typed ids must never hit the DB.
    const commit = (key: string) => {
      const value = (draft[key] ?? "").trim();
      if (draft[key] === undefined) return;
      if (value === String((config ?? {})[key] ?? "")) return;
      saveMutation.mutate({ [key]: value });
      // Adopting the id the charger announced keeps its live socket rather
      // than forcing a reconnect.
      if (key === "ocppChargerId") promote.mutate();
    };

    return {
      next: ocppNext(connected),
      view: (
        <div className={styles.stepContainer}>
          <OcppConnectBlock
            chargerId={values.ocppChargerId ?? ""}
            onDetected={(id) => {
              setDraft((d) => ({ ...d, ocppChargerId: id }));
              saveMutation.mutate({ ocppChargerId: id });
              promote.mutate();
            }}
          />
          <PluginFieldInputs
            fields={fields}
            values={values}
            onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
            onCommit={commit}
          />
        </div>
      ),
    };
  },
};
