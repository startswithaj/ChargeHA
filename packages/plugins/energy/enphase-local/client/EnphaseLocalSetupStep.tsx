import { useCallback, useState } from "react";
import { Text } from "@radix-ui/themes";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { useWizardNextControl } from "../../../../client/src/components/Wizard/wizardNextControl.ts";
import { trpc } from "./trpc.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import {
  EnphaseLocalForm,
  type EnphaseLocalFormValues,
} from "./EnphaseLocalForm.tsx";

export function EnphaseLocalSetupStep(_props: StepProps) {
  const { data: config } = trpc.energy.enphase_local.getConfig.useQuery();
  const saveMutation = trpc.energy.enphase_local.setConfig.useMutation();

  const [validated, setValidated] = useState<EnphaseLocalFormValues | null>(
    null,
  );

  const handleTestSuccess = useCallback((values: EnphaseLocalFormValues) => {
    setValidated(values);
  }, []);

  const save = useCallback(async () => {
    if (!validated) return false;
    try {
      await saveMutation.mutateAsync({
        host: validated.host,
        email: validated.email,
        password: validated.password,
        token: validated.token,
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
      ? "Next saves your Enphase settings"
      : "Test the connection to continue",
    pendingLabel: "Saving...",
    onBeforeNext: save,
  });

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

      {saveMutation.isError && (
        <Text size="2" color="red">{saveMutation.error.message}</Text>
      )}
    </div>
  );
}
