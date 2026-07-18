import { useCallback, useState } from "react";
import {
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import {
  EnphaseLocalForm,
  type EnphaseLocalFormValues,
} from "./EnphaseLocalForm.tsx";

/** Only the tested-connection branch carries a handler, so there is no
 *  "save without a validated connection" state to guard against. */
function enphaseNext(
  validated: EnphaseLocalFormValues | null,
  save: (v: EnphaseLocalFormValues) => Promise<void>,
): WizardNext {
  if (!validated) {
    return { kind: "blocked", reason: "Test the connection to continue" };
  }
  return {
    kind: "ready",
    hint: "Next saves your Enphase settings",
    onNext: () => save(validated),
  };
}

export const enphaseLocalSetupStep: PluginStepDef = {
  id: "enphase-local-setup",
  label: "Enphase Setup",
  useStep: () => {
    const { data: config } = trpc.plugin.energy.enphase_local.getConfig
      .useQuery();
    const saveMutation = trpc.plugin.energy.enphase_local.setConfig
      .useMutation();

    const [validated, setValidated] = useState<EnphaseLocalFormValues | null>(
      null,
    );

    const handleTestSuccess = useCallback((values: EnphaseLocalFormValues) => {
      setValidated(values);
    }, []);

    const save = async (v: EnphaseLocalFormValues) => {
      await saveMutation.mutateAsync({
        host: v.host,
        email: v.email,
        password: v.password,
        token: v.token,
      });
    };

    return {
      next: enphaseNext(validated, save),
      view: (
        <div className={styles.stepContainer}>
          <EnphaseLocalForm
            initial={{
              host: config?.host || "",
              email: config?.email || "",
              password: config?.password || "",
              token: config?.token || "",
            }}
            onTestSuccess={handleTestSuccess}
          />
        </div>
      ),
    };
  },
};
