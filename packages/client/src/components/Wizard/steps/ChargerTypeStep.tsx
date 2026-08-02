import { Text } from "@radix-ui/themes";
import { Plug, Server } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import { chargerPluginOptions } from "@chargeha/plugins/componentRegistry";
import type { StepDef, WizardNext } from "../flow.ts";
import { OptionCard } from "./OptionCard.tsx";
import styles from "./steps.module.css";

const icons = { server: Server, plug: Plug } as const;

function chargerTypeNext(
  loading: boolean,
  selectedType: string | null,
): WizardNext {
  if (selectedType) {
    return {
      kind: "ready",
      hint: "Next continues with the selected charger type",
      onNext: () => Promise.resolve({ chargerType: selectedType }),
    };
  }
  if (loading) return { kind: "loading" };
  return { kind: "blocked", reason: "Select a charger type to continue" };
}

export const chargerTypeStep: StepDef = {
  id: "charger-type",
  label: "Charger Type",
  // Only on the Yes path (review note 1).
  presentWhen: (state) => state.controlPath === "charger",
  useStep: ({ onAdvance }) => {
    const { state, isLoading } = useWizardState();
    const selectedType = state.chargerType;

    return {
      next: chargerTypeNext(isLoading, selectedType),
      view: (
        <div className={styles.stepContainer}>
          <Text as="p" size="3" color="gray">
            What type of smart charger do you have?
          </Text>
          <div className={styles.optionCards}>
            {chargerPluginOptions.map((option) => {
              const Icon = icons[option.iconKey];
              return (
                <OptionCard
                  key={option.id}
                  icon={<Icon size={18} />}
                  title={option.label}
                  description={option.description}
                  selected={option.id === selectedType}
                  onSelect={() => onAdvance({ chargerType: option.id })}
                />
              );
            })}
          </div>
        </div>
      ),
    };
  },
};
