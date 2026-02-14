import { useCallback, useState } from "react";
import { Button } from "@radix-ui/themes";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { trpc } from "./trpc.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import { FroniusCloudForm } from "./FroniusCloudForm.tsx";

export function FroniusCloudSetupStep({ onNext }: StepProps) {
  const { data: config } = trpc.energy.fronius_cloud.getConfig.useQuery();
  const saveMutation = trpc.energy.fronius_cloud.setConfig.useMutation();

  const [validated, setValidated] = useState<
    {
      email: string;
      password: string;
      pvSystemId: string;
    } | null
  >(null);

  const handleTestSuccess = useCallback(
    (email: string, password: string, pvSystemId: string) => {
      setValidated({ email, password, pvSystemId });
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!validated) return;
    saveMutation.mutate(
      {
        froniusCloudEmail: validated.email,
        froniusCloudPassword: validated.password,
        froniusCloudPvSystemId: validated.pvSystemId,
      },
      { onSuccess: () => onNext() },
    );
  }, [validated, saveMutation, onNext]);

  return (
    <div className={styles.stepContainer}>
      <FroniusCloudForm
        initialEmail={config?.froniusCloudEmail || ""}
        initialPvSystemId={config?.froniusCloudPvSystemId || ""}
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
