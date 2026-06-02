import { useRef } from "react";
import { Button, Text } from "@radix-ui/themes";
import { Car, Monitor } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import {
  vehiclePluginOptions,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import { isDemoMode } from "../../../lib/featureFlags.ts";
import type { StepProps } from "../WizardShell.tsx";
import styles from "./steps.module.css";

const icons = {
  car: Car,
  monitor: Monitor,
} as const;

export function VehicleTypeStep({ onNext: _onNext }: StepProps) {
  const wizardState = useWizardState();
  const demoMode = isDemoMode();
  const pendingIdRef = useRef<string | null>(null);

  /** Navigate to the first plugin step, or skip to inverter-type if the plugin has none. */
  const navigateAfterSelection = (type: string) => {
    const pluginSteps = vehiclePluginSteps[type] ?? [];
    if (pluginSteps.length > 0) {
      wizardState.setStepId(pluginSteps[0].id);
    } else {
      wizardState.setStepId("inverter-type");
    }
  };

  const utils = trpc.useUtils();

  // Demo setup mutation — creates a vehicle for plugins that declare demoSetup
  const demoSetupMutation = trpc.wizard.demoSetup.useMutation({
    onSuccess: () => {
      utils.vehicle.list.invalidate();
      const id = pendingIdRef.current;
      if (!id) throw new Error("Expected pending vehicle type ID");
      wizardState.setVehicleType(id);
      navigateAfterSelection(id);
    },
  });

  const handleSelect = (id: string) => {
    const option = vehiclePluginOptions.find((o) => o.id === id);
    if (option?.demoSetup) {
      pendingIdRef.current = id;
      demoSetupMutation.mutate({ adapterType: id });
    } else {
      wizardState.setVehicleType(id);
      navigateAfterSelection(id);
    }
  };

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        What type of vehicle would you like to connect?
      </Text>

      <div className={styles.welcomeButtons}>
        {vehiclePluginOptions.map((option, idx) => {
          const Icon = icons[option.iconKey];
          const isDemoSetup = !!option.demoSetup;
          const demoBlocked = demoMode && !option.demoAvailable;
          return (
            <Button
              key={option.id}
              size="3"
              variant={idx === 0 ? "solid" : "soft"}
              disabled={demoBlocked ||
                (isDemoSetup && demoSetupMutation.isPending)}
              onClick={() => handleSelect(option.id)}
            >
              <Icon size={18} />
              {isDemoSetup && demoSetupMutation.isPending
                ? "Creating..."
                : option.label}
            </Button>
          );
        })}
      </div>

      {vehiclePluginOptions.map((option) => (
        <Text key={option.id} as="p" size="2" color="gray">
          <strong>{option.label}</strong> — {option.description}
        </Text>
      ))}

      {demoSetupMutation.isError && (
        <Text as="p" size="2" color="red">
          {demoSetupMutation.error.message}
        </Text>
      )}
    </div>
  );
}
