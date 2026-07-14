import { useCallback, useState } from "react";
import { Text } from "@radix-ui/themes";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import { useWizardNextControl } from "../../../../client/src/components/Wizard/wizardNextControl.ts";
import { trpc } from "./trpc.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";
import { FroniusLocalForm } from "./FroniusLocalForm.tsx";

export function FroniusLocalSetupStep(_props: StepProps) {
  const { data: config } = trpc.plugin.energy.fronius_local.getConfig
    .useQuery();
  const saveMutation = trpc.plugin.energy.fronius_local.setConfig.useMutation();

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

  const save = useCallback(async () => {
    if (!validated) return false;
    try {
      await saveMutation.mutateAsync({
        froniusHost: validated.host,
        froniusMeterDeviceId: validated.meterDeviceId,
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
      ? "Next saves your Fronius settings"
      : "Test the connection to continue",
    pendingLabel: "Saving...",
    onBeforeNext: save,
  });

  return (
    <div className={styles.stepContainer}>
      <FroniusLocalForm
        initialHost={config?.froniusHost || ""}
        initialMeterDeviceId={config?.froniusMeterDeviceId || "0"}
        onTestSuccess={handleTestSuccess}
      />

      {saveMutation.isError && (
        <Text size="2" color="red">{saveMutation.error.message}</Text>
      )}
    </div>
  );
}
