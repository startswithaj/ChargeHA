import { useCallback, useState } from "react";
import { Button } from "@radix-ui/themes";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { trpc } from "./trpc.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import {
  SigenergyLocalForm,
  type SigenergyLocalFormValues,
} from "./SigenergyLocalForm.tsx";

export function SigenergyLocalSetupStep({ onNext }: StepProps) {
  const { data: config } = trpc.energy.sigenergy_local.getConfig.useQuery();
  const saveMutation = trpc.energy.sigenergy_local.setConfig.useMutation();

  const [validated, setValidated] = useState<SigenergyLocalFormValues | null>(
    null,
  );

  const handleTestSuccess = useCallback((values: SigenergyLocalFormValues) => {
    setValidated(values);
  }, []);

  const handleSave = useCallback(() => {
    if (!validated) return;
    saveMutation.mutate(
      {
        host: validated.host,
        port: validated.port,
        plantUnitId: validated.plantUnitId,
        deviceUnitId: validated.deviceUnitId,
      },
      { onSuccess: () => onNext() },
    );
  }, [validated, saveMutation, onNext]);

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

      <div className={styles.stepActions}>
        <Button size="3" disabled={!validated} onClick={handleSave}>
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
