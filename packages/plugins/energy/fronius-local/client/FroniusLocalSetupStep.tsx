import { useCallback, useState } from "react";
import { Button } from "@radix-ui/themes";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { trpc } from "./trpc.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import { FroniusLocalForm } from "./FroniusLocalForm.tsx";

export function FroniusLocalSetupStep({ onNext }: StepProps) {
  const { data: config } = trpc.energy.fronius_local.getConfig.useQuery();
  const saveMutation = trpc.energy.fronius_local.setConfig.useMutation();

  const [validated, setValidated] = useState<
    {
      host: string;
      meterDeviceId: string;
    } | null
  >(null);

  const handleTestSuccess = useCallback(
    (host: string, meterDeviceId: string) => {
      setValidated({ host, meterDeviceId });
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!validated) return;
    saveMutation.mutate(
      {
        froniusHost: validated.host,
        froniusMeterDeviceId: validated.meterDeviceId,
      },
      { onSuccess: () => onNext() },
    );
  }, [validated, saveMutation, onNext]);

  return (
    <div className={styles.stepContainer}>
      <FroniusLocalForm
        initialHost={config?.froniusHost || ""}
        initialMeterDeviceId={config?.froniusMeterDeviceId || "0"}
        onTestSuccess={handleTestSuccess}
      />

      <div className={styles.stepActions}>
        <Button
          size="3"
          disabled={!validated}
          onClick={handleSave}
        >
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
