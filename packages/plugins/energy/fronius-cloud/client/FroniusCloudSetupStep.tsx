import { useCallback, useState } from "react";
import { Text } from "@radix-ui/themes";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { useWizardNextControl } from "../../../../client/src/components/Wizard/wizardNextControl.ts";
import { trpc } from "./trpc.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import { FroniusCloudForm } from "./FroniusCloudForm.tsx";

export function FroniusCloudSetupStep(_props: StepProps) {
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

  const save = useCallback(async () => {
    if (!validated) return false;
    try {
      await saveMutation.mutateAsync({
        froniusCloudEmail: validated.email,
        froniusCloudPassword: validated.password,
        froniusCloudPvSystemId: validated.pvSystemId,
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
      ? "Next saves your Solar.web settings"
      : "Test the connection to continue",
    pendingLabel: "Saving...",
    onBeforeNext: save,
  });

  return (
    <div className={styles.stepContainer}>
      <FroniusCloudForm
        initialEmail={config?.froniusCloudEmail || ""}
        initialPvSystemId={config?.froniusCloudPvSystemId || ""}
        onTestSuccess={handleTestSuccess}
      />

      {saveMutation.isError && (
        <Text size="2" color="red">{saveMutation.error.message}</Text>
      )}
    </div>
  );
}
