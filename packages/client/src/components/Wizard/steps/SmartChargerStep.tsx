import { Text } from "@radix-ui/themes";
import { Car, Plug } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import type { StepDef, WizardNext } from "../flow.ts";
import { OptionCard } from "./OptionCard.tsx";
import styles from "./steps.module.css";

const OPTIONS = [
  {
    id: "charger" as const,
    icon: <Plug size={18} />,
    title: "Yes",
    description: "ChargeHA will control charging via the smart charger's API.",
  },
  {
    id: "vehicle" as const,
    icon: <Car size={18} />,
    title: "No",
    description:
      "ChargeHA will control charging via your vehicle's API, if your " +
      "vehicle's API supports it. You can use a smart charger with a " +
      "supported vehicle by selecting yes.",
  },
];

// controlPath is nullable: null = never answered, so a fresh install is
// blocked here until the user actively chooses — no pre-selected "No".
function smartChargerNext(
  loading: boolean,
  selected: "charger" | "vehicle" | null,
): WizardNext {
  if (selected) {
    return {
      kind: "ready",
      hint: "Next continues with your charging setup",
      onNext: () =>
        Promise.resolve({
          controlPath: selected,
          // No smart charger → no charger type; clears a stale Yes-path pick.
          ...(selected === "vehicle" && { chargerType: null }),
        }),
    };
  }
  if (loading) return { kind: "loading" };
  return { kind: "blocked", reason: "Choose an option to continue" };
}

export const smartChargerStep: StepDef = {
  id: "smart-charger",
  label: "Smart Charger",
  useStep: ({ onAdvance }) => {
    const { state, isLoading } = useWizardState();
    const selected = state.controlPath;

    return {
      next: smartChargerNext(isLoading, selected),
      view: (
        <div className={styles.stepContainer}>
          <Text as="p" size="3" color="gray">
            Do you have a smart charger?
          </Text>
          <div className={styles.optionCards}>
            {OPTIONS.map((option) => (
              <OptionCard
                key={option.id}
                icon={option.icon}
                title={option.title}
                description={option.description}
                selected={option.id === selected}
                onSelect={() =>
                  onAdvance({
                    controlPath: option.id,
                    ...(option.id === "vehicle" && { chargerType: null }),
                  })}
              />
            ))}
          </div>
        </div>
      ),
    };
  },
};
