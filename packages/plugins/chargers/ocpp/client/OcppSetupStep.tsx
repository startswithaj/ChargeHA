import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import {
  PluginFieldInputs,
  type PluginStepDef,
  PluginTestRow,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { OCPP_DEFAULTS, OCPP_FIELDS } from "./fields.ts";
import { OcppConnectBlock } from "./OcppConnection.tsx";

function ocppNext(
  // No charger row exists yet at this step (the whole point of the wizard),
  // so "connected" can never be true here — an id is the only thing to gate on.
  //
  // Detection is the happy path, but a charge point id is printable — usually
  // the serial on the charger — so a typed id binds just as well as one that
  // announced itself. Also requiring the pairing window to have seen something
  // would trap anyone whose charger reboots slowly.
  idChosen: boolean,
  save: () => Promise<void>,
): WizardNext {
  if (!idChosen) {
    return { kind: "blocked", reason: "Detect a charger, or enter its ID" };
  }
  return {
    kind: "ready",
    hint: "Next saves your OCPP settings",
    onNext: save,
  };
}

export const ocppSetupStep: PluginStepDef = {
  id: "ocpp-setup",
  label: "OCPP Charger",
  useStep: ({ chargerId, setChargerId }) => {
    const configQuery = trpc.plugin.charger.ocpp.getConfig.useQuery(
      chargerId === null ? skipToken : { chargerRowId: chargerId },
    );
    const saveMutation = trpc.plugin.charger.ocpp.setConfig.useMutation();
    const [draft, setDraft] = useState<Record<string, string>>({});
    // Same pairing affordance as the settings panel, so first-run and later
    // edits behave identically.
    const fields = useMemo(
      () => OCPP_FIELDS.filter((f) => f.key !== "ocppChargerId"),
      [],
    );

    const values = { ...OCPP_DEFAULTS, ...(configQuery.data ?? {}), ...draft };
    // The id the charger announced, not a row id — no row exists yet, which is
    // why the test is addressed by charge point id here.
    const chargePointId = (values.ocppChargerId ?? "").trim();
    const idChosen = chargePointId !== "";

    const test = trpc.plugin.charger.ocpp.testConnection.useMutation();
    const result = test.data;
    const testMessage = (() => {
      if (!idChosen) return "Detect or enter a Charger ID first.";
      if (result?.success === false) return result.error;
      if (result?.success === true) {
        return `Responding in ${result.latencyMs} ms`;
      }
      return null;
    })();

    // One save, on Next — selecting a discovered charger and editing fields
    // above only touch local draft state.
    const save = async () => {
      const result = await saveMutation.mutateAsync({
        chargerRowId: chargerId,
        values,
      });
      setChargerId(result.chargerRowId);
    };

    return {
      next: ocppNext(idChosen, save),
      view: (
        <div className={styles.stepContainer}>
          <OcppConnectBlock
            chargerId={values.ocppChargerId ?? ""}
            connected={null}
            info={null}
            onDetected={(id) => setDraft((d) => ({ ...d, ocppChargerId: id }))}
          />
          <PluginTestRow
            pending={test.isPending}
            disabled={!idChosen}
            message={testMessage}
            tone={result?.success === false ? "red" : "gray"}
            onTest={() => test.mutate({ chargePointId })}
          />
          <PluginFieldInputs
            fields={fields}
            values={values}
            onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
          />
        </div>
      ),
    };
  },
};
