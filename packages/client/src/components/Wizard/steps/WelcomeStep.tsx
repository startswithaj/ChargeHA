import { Button, Text } from "@radix-ui/themes";
import { Play, Zap } from "lucide-react";
import { vehiclePluginOptions } from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import { advanceOnly, type StepDef, type StepProps } from "../flow.ts";
import logoSrc from "../../../assets/chargeha_soft-plug_brand.svg";
import styles from "./steps.module.css";

const demoPlugin = vehiclePluginOptions.find((o) => o.demoSetup);

export const welcomeStep: StepDef = {
  id: "welcome",
  label: "Welcome",
  // The step's own buttons drive it; Next is just "Full Setup" by another name.
  useStep: (props) => ({
    next: { kind: "ready", hint: null, onNext: advanceOnly },
    view: <WelcomeContent {...props} />,
  }),
};

function WelcomeContent({ onAdvance, onSkipToEnd }: StepProps) {
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
        <Button size="3" onClick={() => onAdvance()}>
          <Zap size={18} />
          Full Setup
        </Button>

        <Button
          size="3"
          variant="soft"
          onClick={handleDemo}
          disabled={isPending}
        >
          <Play size={18} />
          {isPending ? "Setting up..." : "Demo Mode"}
        </Button>
      </div>

      <Text as="p" size="2" color="gray">
        <strong>Full Setup</strong>{" "}
        walks you through authentication, timezone, your vehicle, energy source,
        and home location — step by step.
      </Text>
      <Text as="p" size="2" color="gray">
        <strong>Demo Mode</strong>{" "}
        skips the wizard and adds a simulated energy source and vehicle so you
        can explore the full app with no manual setup.
      </Text>

      {error && (
        <Text as="p" size="2" color="red">
          {error.message}
        </Text>
      )}
    </div>
  );
}
