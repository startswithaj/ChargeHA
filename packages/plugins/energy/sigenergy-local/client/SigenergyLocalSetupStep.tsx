import { useCallback, useState } from "react";
import { Text } from "@radix-ui/themes";
import type { StepProps } from "../../../hostUi.ts";
import { useWizardNextControl } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { stepStyles as styles } from "../../../hostUi.ts";
import {
  SigenergyLocalForm,
  type SigenergyLocalFormValues,
} from "./SigenergyLocalForm.tsx";

export function SigenergyLocalSetupStep(_props: StepProps) {
  const { data: config } = trpc.plugin.energy.sigenergy_local.getConfig
    .useQuery();
  const saveMutation = trpc.plugin.energy.sigenergy_local.setConfig
    .useMutation();

  const [validated, setValidated] = useState<SigenergyLocalFormValues | null>(
    null,
  );

  const handleTestSuccess = useCallback((values: SigenergyLocalFormValues) => {
    setValidated(values);
  }, []);

  const save = useCallback(async () => {
    if (!validated) return false;
    try {
      await saveMutation.mutateAsync({
        host: validated.host,
        port: validated.port,
        plantUnitId: validated.plantUnitId,
        deviceUnitId: validated.deviceUnitId,
      });
      return true;
    } catch {
      // Stay on the step — the mutation error is rendered below the form.
      return false;
    }
  }, [validated, saveMutation]);

  useWizardNextControl({
    canProceed: validated !== null,
    hint: validated
      ? "Next saves your Sigenergy settings"
      : "Test the connection to continue",
    pendingLabel: "Saving...",
    onBeforeNext: save,
  });

  return (
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

      {saveMutation.isError && (
        <Text size="2" color="red">{saveMutation.error.message}</Text>
      )}
    </div>
  );
}
