import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import {
  PluginFieldInputs,
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { OCPP_DEFAULTS, OCPP_FIELDS } from "./fields.ts";
import { OcppConnectBlock } from "./OcppConnection.tsx";

function ocppNext(
  // No charger row exists yet at this step (the whole point of the wizard),
  // so "connected" can never be true here — gate on the pairing window
  // having actually seen a charger, plus the user having picked one, instead.
  seenAny: boolean,
  idChosen: boolean,
  save: () => Promise<void>,
): WizardNext {
  if (!seenAny) {
    return { kind: "blocked", reason: "Waiting for a charger to answer" };
  }
  if (!idChosen) {
    return { kind: "blocked", reason: "Choose a charger" };
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
    // Row-independent — no charger row exists yet at this step.
    const pairingStatus = trpc.plugin.charger.ocpp.pairingStatus.useQuery(
      undefined,
      { refetchInterval: 2000 },
    );
    const [draft, setDraft] = useState<Record<string, string>>({});
    // Same pairing affordance as the settings panel, so first-run and later
    // edits behave identically.
    const fields = useMemo(
      () => OCPP_FIELDS.filter((f) => f.key !== "ocppChargerId"),
      [],
    );

    const values = { ...OCPP_DEFAULTS, ...(configQuery.data ?? {}), ...draft };
    const seenAny = (pairingStatus.data?.pairing.seen.length ?? 0) > 0;
    const idChosen = (values.ocppChargerId ?? "") !== "";

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
      next: ocppNext(seenAny, idChosen, save),
      view: (
        <div className={styles.stepContainer}>
          <OcppConnectBlock
            chargerId={values.ocppChargerId ?? ""}
            connected={null}
            info={null}
            onDetected={(id) => setDraft((d) => ({ ...d, ocppChargerId: id }))}
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
