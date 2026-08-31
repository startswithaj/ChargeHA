import { useRef } from "react";
import { Text } from "@radix-ui/themes";
import { Car, Monitor } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import {
  type VehiclePluginOption,
  vehiclePluginOptions,
} from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import type { StepDef, WizardNext } from "../flow.ts";
import { OptionCard } from "./OptionCard.tsx";
import styles from "./steps.module.css";
import { FormError } from "../../ui/FormError.tsx";

const icons = {
  car: Car,
  monitor: Monitor,
} as const;

// On the charger path the step is explicitly optional: a
// "No vehicle" card advances with vehicleType: null.
const skipOption: VehiclePluginOption = {
  id: "skip", // card identity only — selecting it stores vehicleType: null
  label: "No vehicle — skip",
  description:
    "Solar charging works without a vehicle connection. Adding one later " +
    "gives battery level, charge limit and location.",
  iconKey: "monitor",
  demoAvailable: true,
};

export const vehicleTypeStep: StepDef = {
  id: "vehicle-type",
  label: "Vehicle Type",
  useStep: ({ onAdvance }) => {
    const { state, isLoading } = useWizardState();
    const utils = trpc.useUtils();
    const pendingIdRef = useRef<string | null>(null);

    const { data: vehiclesData } = trpc.vehicle.list.useQuery();
    const existingType = vehiclesData?.vehicles?.[0]?.adapterType ?? null;
    // null means EITHER "skipped" or "not yet chosen"; the two are
    // distinguished by step position: this step is only ever rendered with
    // a stored stepId other than its own once the wizard has moved past it,
    // so a mismatch here means the null was written by an explicit skip.
    const skipChosen = state.vehicleType === null &&
      state.stepId !== null && state.stepId !== "vehicle-type";
    const selectedType = skipChosen ? null : state.vehicleType ?? existingType;

    // Demo setup mutation — creates a vehicle for plugins that declare demoSetup
    const demoSetupMutation = trpc.wizard.demoSetup.useMutation({
      onSuccess: () => {
        utils.vehicle.list.invalidate();
        const id = pendingIdRef.current;
        pendingIdRef.current = null;
        // Throwing here would be an unhandled rejection; the selection just won't advance.
        if (id) onAdvance({ vehicleType: id });
      },
    });

    const handleSelect = (id: string) => {
      if (id === "skip") {
        onAdvance({ vehicleType: null });
        return;
      }
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
        skipChosen,
      ),
      view: (
        <VehicleTypeCards
          isChargerPath={state.controlPath === "charger"}
          selectedType={selectedType}
          skipChosen={skipChosen}
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
  selectedType: string | null,
  skipChosen: boolean,
): WizardNext {
  // skipChosen carries selectedType===null forward as a real decision, not
  // an unanswered one.
  if (selectedType || skipChosen) {
    return {
      kind: "ready",
      hint: "Next continues with the selected vehicle type",
      // Return the chosen type so the shell saves it and picks the next step in one go.
      onNext: () => Promise.resolve({ vehicleType: selectedType }),
    };
  }
  if (loading) return { kind: "loading" };
  return { kind: "blocked", reason: "Select a vehicle type to continue" };
}

function VehicleTypeCards(
  { isChargerPath, selectedType, skipChosen, creating, error, onSelect }: {
    isChargerPath: boolean;
    selectedType: string | null;
    skipChosen: boolean;
    creating: boolean;
    error: string | null;
    onSelect: (id: string) => void;
  },
) {
  const inDemo = demoMode.isActive();
  const options = isChargerPath
    ? [...vehiclePluginOptions, skipOption]
    : vehiclePluginOptions;

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        {isChargerPath
          ? "Optionally connect a vehicle. ChargeHA charges via your smart charger either way — a vehicle connection adds battery level and charge limit."
          : "What type of vehicle would you like to connect?"}
      </Text>

      <div className={styles.optionCards}>
        {options.map((option) => {
          const Icon = icons[option.iconKey];
          const demoBlocked = inDemo && !option.demoAvailable;
          const pending = !!option.demoSetup && creating;
          const selected = option.id === "skip"
            ? skipChosen
            : option.id === selectedType;
          return (
            <OptionCard
              key={option.id}
              icon={<Icon size={18} />}
              title={pending ? "Creating..." : option.label}
              description={demoBlocked
                ? "Not available in demo mode."
                : option.description}
              selected={selected}
              disabled={demoBlocked || pending}
              onSelect={() => onSelect(option.id)}
            />
          );
        })}
      </div>

      <FormError message={error} size="2" />
    </div>
  );
}
