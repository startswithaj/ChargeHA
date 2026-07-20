import { Text } from "@radix-ui/themes";
import { Cloud, Monitor, Server, SkipForward } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import { energyPluginOptions } from "@chargeha/plugins/componentRegistry";
import {
  useEquipmentConfig,
  useEquipmentConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import type { StepDef, WizardNext } from "../flow.ts";
import { OptionCard } from "./OptionCard.tsx";
import styles from "./steps.module.css";

const icons = {
  server: Server,
  cloud: Cloud,
  monitor: Monitor,
} as const;

export const inverterTypeStep: StepDef = {
  id: "inverter-type",
  label: "Inverter Type",
  useStep: ({ onAdvance }) => {
    const { data: equipmentConfig } = useEquipmentConfig();
    const currentAdapter = equipmentConfig?.energyAdapterType ?? "";
    const { state } = useWizardState();
    const mutation = useEquipmentConfigMutation();

    // "" (None / Skip) is a valid selection but indistinguishable from "not
    // chosen yet" in config — track this session's explicit choice as well.
    const hasSelection = !!currentAdapter || !!state.energyType;
    const selectedType = state.energyType || currentAdapter;

    const selectAdapter = (adapterType: string) => {
      mutation.mutate(
        { energyAdapterType: adapterType },
        { onSuccess: () => onAdvance({ energyType: adapterType }) },
      );
    };

    return {
      next: inverterTypeNext(
        equipmentConfig === undefined,
        hasSelection,
        selectedType,
      ),
      view: (
        <InverterTypeCards
          currentAdapter={currentAdapter}
          onSelect={selectAdapter}
        />
      ),
    };
  },
};

function inverterTypeNext(
  loading: boolean,
  hasSelection: boolean,
  selectedType: string,
): WizardNext {
  if (hasSelection) {
    return {
      kind: "ready",
      hint: "Next continues with the selected energy source",
      // Hand the chosen source back rather than just moving on — the card can
      // already look selected from saved config while the wizard has nothing
      // recorded. See the note in VehicleTypeStep for why this matters.
      onNext: () => Promise.resolve({ energyType: selectedType }),
    };
  }
  if (loading) return { kind: "loading" };
  return {
    kind: "blocked",
    reason: "Select an energy source (or None / Skip) to continue",
  };
}

function InverterTypeCards(
  { currentAdapter, onSelect }: {
    currentAdapter: string;
    onSelect: (adapterType: string) => void;
  },
) {
  const inDemo = demoMode.isActive();

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Select your solar inverter or energy monitor to enable solar tracking
        and smart charging. You can configure this later in Settings.
      </Text>

      <div className={styles.optionCards}>
        {energyPluginOptions.map((option) => {
          const Icon = icons[option.iconKey];
          return (
            <OptionCard
              key={option.id}
              icon={<Icon size={18} />}
              title={option.label}
              description={option.description}
              selected={currentAdapter === option.id}
              disabled={inDemo && !option.demoAvailable}
              onSelect={() => onSelect(option.id)}
            />
          );
        })}

        <OptionCard
          icon={<SkipForward size={18} />}
          title="None / Skip"
          description="Skip energy source configuration for now. You can add one later in Settings."
          onSelect={() => onSelect("")}
        />
      </div>
    </div>
  );
}
