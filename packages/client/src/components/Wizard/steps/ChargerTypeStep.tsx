import { Text } from "@radix-ui/themes";
import { Monitor, Plug, Server } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import {
  type ChargerPluginOption,
  chargerPluginOptions,
} from "@chargeha/plugins/componentRegistry";
import { demoMode } from "../../../lib/featureFlags.ts";
import { trpc } from "../../../trpc.ts";
import type { StepDef, WizardNext } from "../flow.ts";
import { OptionCard } from "./OptionCard.tsx";
import styles from "./steps.module.css";

const icons = { server: Server, plug: Plug, monitor: Monitor } as const;

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
  // Only on the "Yes, I have a smart charger" path.
  presentWhen: (state) => state.controlPath === "charger",
  useStep: ({ onAdvance }) => {
    const { state, isLoading } = useWizardState();
    const selectedType = state.chargerType;
    const ensureMutation = trpc.charger.ensure.useMutation();

    // A type with no setup step of its own (ensureOnSelect) gets its row
    // created here — ensure is idempotent, so re-selecting is safe.
    const select = async (option: ChargerPluginOption) => {
      if (option.ensureOnSelect) {
        await ensureMutation.mutateAsync({ chargerAdapterType: option.id });
      }
      onAdvance({ chargerType: option.id });
    };

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
              // In demo, real hardware plugins can't be served.
              const blocked = demoMode.blockedPlugins(chargerPluginOptions);
              return (
                <OptionCard
                  key={option.id}
                  icon={<Icon size={18} />}
                  title={option.label}
                  description={option.description}
                  selected={option.id === selectedType}
                  disabled={blocked.has(option.id)}
                  onSelect={() => select(option)}
                />
              );
            })}
          </div>
          {ensureMutation.isError && (
            <Text size="2" color="red">{ensureMutation.error.message}</Text>
          )}
        </div>
      ),
    };
  },
};
