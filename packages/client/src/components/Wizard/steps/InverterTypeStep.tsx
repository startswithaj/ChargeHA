import { Text } from "@radix-ui/themes";
import { Cloud, Server, SkipForward } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import {
  energyPluginOptions,
  energyPluginSteps,
} from "@chargeha/plugins/componentRegistry";
import {
  useEquipmentConfig,
  useEquipmentConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { isDemoMode } from "../../../lib/featureFlags.ts";
import type { StepProps } from "../WizardShell.tsx";
import styles from "./steps.module.css";

const icons = {
  server: Server,
  cloud: Cloud,
} as const;

export function InverterTypeStep(_props: StepProps) {
  const { data: equipmentConfig } = useEquipmentConfig();
  const currentAdapter = equipmentConfig?.energyAdapterType ?? "";
  const wizardState = useWizardState();
  const demoMode = isDemoMode();

  const mutation = useEquipmentConfigMutation();

  const selectAdapter = (adapterType: string) => {
    mutation.mutate(
      { energyAdapterType: adapterType },
      {
        onSuccess: () => {
          wizardState.setEnergyType(adapterType);
          // Navigate to the first energy plugin step, or skip to home-location if none
          const pluginSteps = energyPluginSteps[adapterType] ?? [];
          if (pluginSteps.length > 0) {
            wizardState.setStepId(pluginSteps[0].id);
          } else {
            wizardState.setStepId("home-location");
          }
        },
      },
    );
  };

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Select your solar inverter or energy monitor to enable solar tracking
        and smart charging. You can configure this later in Settings.
      </Text>

      <div className={styles.optionCards}>
        {energyPluginOptions.map((option) => {
          const Icon = icons[option.iconKey];
          const demoBlocked = demoMode && !option.demoAvailable;
          return (
            <div
              key={option.id}
              className={`${styles.optionCard} ${
                currentAdapter === option.id ? styles.optionCardSelected : ""
              }`}
              role="button"
              aria-disabled={demoBlocked}
              tabIndex={demoBlocked ? -1 : 0}
              style={demoBlocked
                ? { opacity: 0.5, cursor: "not-allowed" }
                : undefined}
              onClick={() => {
                if (!demoBlocked) selectAdapter(option.id);
              }}
              onKeyDown={(e) => {
                if (demoBlocked) return;
                if (e.key === "Enter" || e.key === " ") {
                  selectAdapter(option.id);
                }
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <Icon size={18} />
                <Text weight="bold">{option.label}</Text>
              </div>
              <Text size="2" color="gray">
                {option.description}
              </Text>
            </div>
          );
        })}

        <div
          className={styles.optionCard}
          role="button"
          tabIndex={0}
          onClick={() => selectAdapter("")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              selectAdapter("");
            }
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <SkipForward size={18} />
            <Text weight="bold">None / Skip</Text>
          </div>
          <Text size="2" color="gray">
            Skip energy source configuration for now. You can add one later in
            Settings.
          </Text>
        </div>
      </div>
    </div>
  );
}
