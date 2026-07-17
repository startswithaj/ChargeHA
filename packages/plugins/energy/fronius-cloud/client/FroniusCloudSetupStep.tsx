import { useCallback, useState } from "react";
import {
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { FroniusCloudForm } from "./FroniusCloudForm.tsx";

/** Only the tested-connection branch carries a handler, so there is no
 *  "save without a validated connection" state to guard against. */
function froniusCloudNext(
  validated: { email: string; password: string; pvSystemId: string } | null,
  save: (
    v: { email: string; password: string; pvSystemId: string },
  ) => Promise<void>,
): WizardNext {
  if (!validated) {
    return { kind: "blocked", reason: "Test the connection to continue" };
  }
  return {
    kind: "ready",
    hint: "Next saves your Solar.web settings",
    onNext: () => save(validated),
  };
}

export const froniusCloudSetupStep: PluginStepDef = {
  id: "fronius-cloud-setup",
  label: "Fronius Cloud Setup",
  useStep: () => {
    const { data: config } = trpc.plugin.energy.fronius_cloud.getConfig
      .useQuery();
    const saveMutation = trpc.plugin.energy.fronius_cloud.setConfig
      .useMutation();

    const [validated, setValidated] = useState<
      { email: string; password: string; pvSystemId: string } | null
    >(null);

    const handleTestSuccess = useCallback(
      (email: string, password: string, pvSystemId: string) => {
        setValidated({ email, password, pvSystemId });
      },
      [],
    );

    const save = async (
      v: { email: string; password: string; pvSystemId: string },
    ) => {
      await saveMutation.mutateAsync({
        froniusCloudEmail: v.email,
        froniusCloudPassword: v.password,
        froniusCloudPvSystemId: v.pvSystemId,
      });
    };

    return {
      next: froniusCloudNext(validated, save),
      view: (
        <div className={styles.stepContainer}>
          <FroniusCloudForm
            initialEmail={config?.froniusCloudEmail || ""}
            initialPvSystemId={config?.froniusCloudPvSystemId || ""}
            onTestSuccess={handleTestSuccess}
          />
        </div>
      ),
    };
  },
};
