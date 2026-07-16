import { Text } from "@radix-ui/themes";
import { Cloud, Monitor, Server, SkipForward } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import {
  energyPluginOptions,
  energyPluginSteps,
} from "@chargeha/plugins/componentRegistry";
import {
  useEquipmentConfig,
  useEquipmentConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import {
  hintUnlessLoading,
  useWizardNextControl,
} from "../wizardNextControl.ts";
import styles from "./steps.module.css";

const icons = {
  server: Server,
  cloud: Cloud,
  monitor: Monitor,
} as const;

export function InverterTypeStep() {
  const { data: equipmentConfig } = useEquipmentConfig();
  const currentAdapter = equipmentConfig?.energyAdapterType ?? "";
  const wizardState = useWizardState();
  const inDemo = demoMode.isActive();

  const mutation = useEquipmentConfigMutation();

  // "" (None / Skip) is a valid selection but indistinguishable from "not
  // chosen yet" in config — track this session's explicit choice as well.
  const sessionChoice = wizardState.energyType;
  const hasSelection = !!currentAdapter || !!sessionChoice;
  // No hint until the config query settles — a blocked-hint that flips to
  // ready milliseconds after mount reads as an orange flash in the nav.
  const loading = equipmentConfig === undefined;
  useWizardNextControl({
    canProceed: hasSelection,
    hint: hintUnlessLoading(
      loading,
      hasSelection
        ? "Next continues with the selected energy source"
        : "Select an energy source (or None / Skip) to continue",
    ),
  });

  const selectAdapter = (adapterType: string) => {
    mutation.mutate(
      { energyAdapterType: adapterType },
      {
        onSuccess: () => {
          // Navigate to the first energy plugin step, or skip to home-location if none
          const pluginSteps = energyPluginSteps[adapterType] ?? [];
          const stepId = pluginSteps.length > 0
            ? pluginSteps[0].id
            : "home-location";
          wizardState.commitSelection({ energyType: adapterType, stepId });
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
          const demoBlocked = inDemo && !option.demoAvailable;
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

        <NoneCard onSelect={() => selectAdapter("")} />
      </div>
    </div>
  );
}

function NoneCard({ onSelect }: { onSelect: () => void }) {
  return (
    <div
      className={styles.optionCard}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <SkipForward size={18} />
        <Text weight="bold">None / Skip</Text>
      </div>
      <Text size="2" color="gray">
        Skip energy source configuration for now. You can add one later in
        Settings.
      </Text>
    </div>
  );
}
