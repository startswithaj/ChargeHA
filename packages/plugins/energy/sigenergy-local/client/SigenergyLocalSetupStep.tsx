import { useCallback, useState } from "react";
import {
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import {
  SigenergyLocalForm,
  type SigenergyLocalFormValues,
} from "./SigenergyLocalForm.tsx";

/** Only the tested-connection branch carries a handler, so there is no
 *  "save without a validated connection" state to guard against. */
function sigenergyNext(
  validated: SigenergyLocalFormValues | null,
  save: (v: SigenergyLocalFormValues) => Promise<void>,
): WizardNext {
  if (!validated) {
    return { kind: "blocked", reason: "Test the connection to continue" };
  }
  return {
    kind: "ready",
    hint: "Next saves your Sigenergy settings",
    onNext: () => save(validated),
  };
}

export const sigenergyLocalSetupStep: PluginStepDef = {
  id: "sigenergy-local-setup",
  label: "Sigenergy Setup",
  useStep: () => {
    const { data: config } = trpc.plugin.energy.sigenergy_local.getConfig
      .useQuery();
    const saveMutation = trpc.plugin.energy.sigenergy_local.setConfig
      .useMutation();

    const [validated, setValidated] = useState<SigenergyLocalFormValues | null>(
      null,
    );

    const handleTestSuccess = useCallback(
      (values: SigenergyLocalFormValues) => {
        setValidated(values);
      },
      [],
    );

    const save = async (v: SigenergyLocalFormValues) => {
      await saveMutation.mutateAsync({
        host: v.host,
        port: v.port,
        plantUnitId: v.plantUnitId,
        deviceUnitId: v.deviceUnitId,
      });
    };

    return {
      next: sigenergyNext(validated, save),
      view: (
        <div className={styles.stepContainer}>
          <SigenergyLocalForm
            initial={{
              host: config?.host || "",
              port: config?.port || "502",
              plantUnitId: config?.plantUnitId || "247",
              deviceUnitId: config?.deviceUnitId || "1",
            }}
            onTestSuccess={handleTestSuccess}
          />
        </div>
      ),
    };
  },
};
