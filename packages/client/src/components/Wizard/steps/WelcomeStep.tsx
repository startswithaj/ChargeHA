import { Button, Text } from "@radix-ui/themes";
import { Play, Zap } from "lucide-react";
import { vehiclePluginOptions } from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import type { StepProps } from "../WizardShell.tsx";
import logoSrc from "../../../assets/chargeha_soft-plug_brand.svg";
import styles from "./steps.module.css";

const demoPlugin = vehiclePluginOptions.find((o) => o.demoSetup);

export function WelcomeStep({ onNext, onSkipToEnd }: StepProps) {
  const utils = trpc.useUtils();

  const demoSetupMutation = trpc.wizard.demoSetup.useMutation();
  const completeMutation = trpc.wizard.complete.useMutation({
    onSuccess: () => onSkipToEnd(),
  });

  const handleDemo = () => {
    if (!demoPlugin) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    demoSetupMutation.mutate({ adapterType: demoPlugin.id, timezone }, {
      onSuccess: () => {
        utils.vehicle.list.invalidate();
        completeMutation.mutate();
      },
    });
  };

  const isPending = demoSetupMutation.isPending || completeMutation.isPending;
  const error = demoSetupMutation.error ?? completeMutation.error;

  return (
    <div className={styles.stepContainer}>
      <img
        src={logoSrc}
        alt="ChargeHA"
        style={{ width: 80, height: 80, borderRadius: 16, alignSelf: "center" }}
      />

      <Text as="p" size="3" color="gray">
        ChargeHA is a smart home charging controller that optimises your
        electric vehicle charging using solar production data from your
        inverter. It automatically adjusts charge rates to maximise
        self-consumption and minimise grid usage.
      </Text>

      <div className={styles.welcomeButtons}>
        <Button size="3" onClick={onNext}>
          <Zap size={18} />
          Full Setup
        </Button>

        {!demoMode.isActive() && (
          <Button
            size="3"
            variant="soft"
            onClick={handleDemo}
            disabled={isPending}
          >
            <Play size={18} />
            {isPending ? "Setting up..." : "Demo Mode"}
          </Button>
        )}
      </div>

      <Text as="p" size="2" color="gray">
        <strong>Full Setup</strong>{" "}
        guides you through connecting to your vehicle and energy inverter or
        smart meter step by step.
      </Text>
      {!demoMode.isActive() && (
        <Text as="p" size="2" color="gray">
          <strong>Demo Mode</strong>{" "}
          creates a simulated vehicle so you can explore the dashboard without
          connecting real hardware.
        </Text>
      )}

      {error && (
        <Text as="p" size="2" color="red">
          {error.message}
        </Text>
      )}
    </div>
  );
}
