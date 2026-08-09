import { useCallback, useState } from "react";
import {
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { GoodweSemsForm } from "./GoodweSemsForm.tsx";

interface ValidatedConnection {
  account: string;
  password: string;
  stationId: string;
}

/** Only the tested-connection branch carries a handler, so there is no
 *  "save without a validated connection" state to guard against. */
function goodweSemsNext(
  validated: ValidatedConnection | null,
  save: (v: ValidatedConnection) => Promise<void>,
): WizardNext {
  if (!validated) {
    return { kind: "blocked", reason: "Test the connection to continue" };
  }
  return {
    kind: "ready",
    hint: "Next saves your SEMS Portal settings",
    onNext: () => save(validated),
  };
}

export const goodweSemsSetupStep: PluginStepDef = {
  id: "goodwe-sems-setup",
  label: "GoodWe SEMS Setup",
  useStep: () => {
    const { data: config } = trpc.plugin.energy.goodwe_sems.getConfig
      .useQuery();
    const saveMutation = trpc.plugin.energy.goodwe_sems.setConfig.useMutation();

    const [validated, setValidated] = useState<ValidatedConnection | null>(
      null,
    );

    const handleTestSuccess = useCallback(
      (account: string, password: string, stationId: string) => {
        setValidated({ account, password, stationId });
      },
      [],
    );

    const save = async (v: ValidatedConnection) => {
      await saveMutation.mutateAsync({
        goodweSemsAccount: v.account,
        goodweSemsPassword: v.password,
        goodweSemsStationId: v.stationId,
      });
    };

    return {
      next: goodweSemsNext(validated, save),
      view: (
        <div className={styles.stepContainer}>
          <GoodweSemsForm
            initialAccount={config?.goodweSemsAccount || ""}
            initialStationId={config?.goodweSemsStationId || ""}
            onTestSuccess={handleTestSuccess}
          />
        </div>
      ),
    };
  },
};
