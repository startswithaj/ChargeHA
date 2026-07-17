import { useCallback, useState } from "react";
import {
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { FroniusLocalForm } from "./FroniusLocalForm.tsx";

/** Only the tested-connection branch carries a handler, so there is no
 *  "save without a validated connection" state to guard against. */
function froniusLocalNext(
  validated: { host: string; meterDeviceId: string } | null,
  save: (v: { host: string; meterDeviceId: string }) => Promise<void>,
): WizardNext {
  if (!validated) {
    return { kind: "blocked", reason: "Test the connection to continue" };
  }
  return {
    kind: "ready",
    hint: "Next saves your Fronius settings",
    onNext: () => save(validated),
  };
}

export const froniusLocalSetupStep: PluginStepDef = {
  id: "fronius-local-setup",
  label: "Fronius Local Setup",
  useStep: () => {
    const { data: config } = trpc.plugin.energy.fronius_local.getConfig
      .useQuery();
    const saveMutation = trpc.plugin.energy.fronius_local.setConfig
      .useMutation();

    const [validated, setValidated] = useState<
      { host: string; meterDeviceId: string } | null
    >(null);

    const handleTestSuccess = useCallback(
      (host: string, meterDeviceId: string) => {
        setValidated({ host, meterDeviceId });
      },
      [],
    );

    const save = async (v: { host: string; meterDeviceId: string }) => {
      await saveMutation.mutateAsync({
        froniusHost: v.host,
        froniusMeterDeviceId: v.meterDeviceId,
      });
    };

    return {
      next: froniusLocalNext(validated, save),
      view: (
        <div className={styles.stepContainer}>
          <FroniusLocalForm
            initialHost={config?.froniusHost || ""}
            initialMeterDeviceId={config?.froniusMeterDeviceId || "0"}
            onTestSuccess={handleTestSuccess}
          />
        </div>
      ),
    };
  },
};
