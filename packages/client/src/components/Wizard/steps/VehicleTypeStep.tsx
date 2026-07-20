import { useRef } from "react";
import { Text } from "@radix-ui/themes";
import { Car, Monitor } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import { vehiclePluginOptions } from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import type { StepDef, WizardNext } from "../flow.ts";
import { OptionCard } from "./OptionCard.tsx";
import styles from "./steps.module.css";

const icons = {
  car: Car,
  monitor: Monitor,
} as const;

export const vehicleTypeStep: StepDef = {
  id: "vehicle-type",
  label: "Vehicle Type",
  useStep: ({ onAdvance }) => {
    const { state, isLoading } = useWizardState();
    const utils = trpc.useUtils();
    const pendingIdRef = useRef<string | null>(null);

    const { data: vehiclesData } = trpc.vehicle.list.useQuery();
    const existingType = vehiclesData?.vehicles?.[0]?.adapterType ?? "";
    const selectedType = state.vehicleType || existingType;

    // Demo setup mutation — creates a vehicle for plugins that declare demoSetup
    const demoSetupMutation = trpc.wizard.demoSetup.useMutation({
      onSuccess: () => {
        utils.vehicle.list.invalidate();
        const id = pendingIdRef.current;
        pendingIdRef.current = null;
        // Throwing here would surface as an unhandled rejection rather than
        // anything an error boundary catches — the selection just won't advance.
        if (id) onAdvance({ vehicleType: id });
      },
    });

    const handleSelect = (id: string) => {
      const option = vehiclePluginOptions.find((o) => o.id === id);
      // Already set up with this type — continue without recreating.
      if (option?.demoSetup && id !== selectedType) {
        pendingIdRef.current = id;
        demoSetupMutation.mutate({ adapterType: id });
        return;
      }
      onAdvance({ vehicleType: id });
    };

    return {
      next: vehicleTypeNext(
        vehiclesData === undefined || isLoading,
        selectedType,
      ),
      view: (
        <VehicleTypeCards
          selectedType={selectedType}
          creating={demoSetupMutation.isPending}
          error={demoSetupMutation.error?.message ?? null}
          onSelect={handleSelect}
        />
      ),
    };
  },
};

function vehicleTypeNext(
  loading: boolean,
  selectedType: string,
): WizardNext {
  if (selectedType) {
    return {
      kind: "ready",
      hint: "Next continues with the selected vehicle type",
      // Hand the chosen type back rather than just moving on. The card can
      // already look selected because a vehicle exists from a previous setup,
      // while the wizard itself has no type recorded. Returning it lets the
      // shell save the choice and work out the next step in one go — if it
      // works out the next step first, it doesn't know Tesla was chosen and
      // jumps straight past Tesla's setup screens.
      onNext: () => Promise.resolve({ vehicleType: selectedType }),
    };
  }
  if (loading) return { kind: "loading" };
  return { kind: "blocked", reason: "Select a vehicle type to continue" };
}

function VehicleTypeCards(
  { selectedType, creating, error, onSelect }: {
    selectedType: string;
    creating: boolean;
    error: string | null;
    onSelect: (id: string) => void;
  },
) {
  const inDemo = demoMode.isActive();

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        What type of vehicle would you like to connect?
      </Text>

      <div className={styles.optionCards}>
        {vehiclePluginOptions.map((option) => {
          const Icon = icons[option.iconKey];
          const demoBlocked = inDemo && !option.demoAvailable;
          const pending = !!option.demoSetup && creating;
          return (
            <OptionCard
              key={option.id}
              icon={<Icon size={18} />}
              title={pending ? "Creating..." : option.label}
              description={demoBlocked
                ? "Not available in demo mode."
                : option.description}
              selected={option.id === selectedType}
              disabled={demoBlocked || pending}
              onSelect={() => onSelect(option.id)}
            />
          );
        })}
      </div>

      {error && (
        <Text as="p" size="2" color="red">
          {error}
        </Text>
      )}
    </div>
  );
}
