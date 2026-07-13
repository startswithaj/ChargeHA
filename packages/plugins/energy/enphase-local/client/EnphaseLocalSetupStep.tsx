import { useCallback, useState } from "react";
import { Button } from "@radix-ui/themes";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { trpc } from "./trpc.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import {
  EnphaseLocalForm,
  type EnphaseLocalFormValues,
} from "./EnphaseLocalForm.tsx";

export function EnphaseLocalSetupStep({ onNext }: StepProps) {
  const { data: config } = trpc.energy.enphase_local.getConfig.useQuery();
  const saveMutation = trpc.energy.enphase_local.setConfig.useMutation();

  const [validated, setValidated] = useState<EnphaseLocalFormValues | null>(
    null,
  );

  const handleTestSuccess = useCallback((values: EnphaseLocalFormValues) => {
    setValidated(values);
  }, []);

  const handleSave = useCallback(() => {
    if (!validated) return;
    saveMutation.mutate(
      {
        host: validated.host,
        email: validated.email,
        password: validated.password,
        token: validated.token,
      },
      { onSuccess: () => onNext() },
    );
  }, [validated, saveMutation, onNext]);

  return (
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

      <div className={styles.stepActions}>
        <Button size="3" disabled={!validated} onClick={handleSave}>
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
