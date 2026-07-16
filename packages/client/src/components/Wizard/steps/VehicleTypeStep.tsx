import { useRef } from "react";
import { Text } from "@radix-ui/themes";
import { Car, Monitor } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import {
  vehiclePluginOptions,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import {
  hintUnlessLoading,
  useWizardNextControl,
} from "../wizardNextControl.ts";
import styles from "./steps.module.css";

const icons = {
  car: Car,
  monitor: Monitor,
} as const;

function TypeCard(
  { icon, title, description, selected, disabled, onSelect }: {
    icon: React.ReactNode;
    title: string;
    description: string;
    selected: boolean;
    disabled: boolean;
    onSelect: () => void;
  },
) {
  return (
    <div
      className={`${styles.optionCard} ${
        selected ? styles.optionCardSelected : ""
      }`}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) onSelect();
      }}
    >
      <Text as="p" size="3" weight="medium">
        {icon} {title}
      </Text>
      <Text as="p" size="2" color="gray">{description}</Text>
    </div>
  );
}

export function VehicleTypeStep() {
  const wizardState = useWizardState();
  const inDemo = demoMode.isActive();
  const pendingIdRef = useRef<string | null>(null);

  /** Set the vehicle type and move to the first plugin step (or inverter-type
   *  if the plugin has none) in one atomic commit. */
  const selectVehicleType = (type: string) => {
    const pluginSteps = vehiclePluginSteps[type] ?? [];
    const stepId = pluginSteps.length > 0 ? pluginSteps[0].id : "inverter-type";
    wizardState.commitSelection({ vehicleType: type, stepId });
  };

  const utils = trpc.useUtils();

  const { data: vehiclesData } = trpc.vehicle.list.useQuery();
  const existingType = vehiclesData?.vehicles?.[0]?.adapterType ?? "";
  const selectedType = wizardState.vehicleType || existingType;

  useWizardNextControl({
    canProceed: !!selectedType,
    hint: hintUnlessLoading(
      vehiclesData === undefined || wizardState.isLoading,
      selectedType
        ? "Next continues with the selected vehicle type"
        : "Select a vehicle type to continue",
    ),
  });

  // Demo setup mutation — creates a vehicle for plugins that declare demoSetup
  const demoSetupMutation = trpc.wizard.demoSetup.useMutation({
    onSuccess: () => {
      utils.vehicle.list.invalidate();
      const id = pendingIdRef.current;
      if (!id) throw new Error("Expected pending vehicle type ID");
      selectVehicleType(id);
    },
  });

  const handleSelect = (id: string) => {
    const option = vehiclePluginOptions.find((o) => o.id === id);
    if (id === selectedType) {
      // Already set up with this type — continue without recreating.
      selectVehicleType(id);
      return;
    }
    if (option?.demoSetup) {
      pendingIdRef.current = id;
      demoSetupMutation.mutate({ adapterType: id });
    } else {
      selectVehicleType(id);
    }
  };

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        What type of vehicle would you like to connect?
      </Text>

      <div className={styles.optionCards}>
        {vehiclePluginOptions.map((option) => {
          const Icon = icons[option.iconKey];
          const isDemoSetup = !!option.demoSetup;
          const demoBlocked = inDemo && !option.demoAvailable;
          const pending = isDemoSetup && demoSetupMutation.isPending;
          return (
            <TypeCard
              key={option.id}
              icon={<Icon size={16} style={{ verticalAlign: -3 }} />}
              title={pending ? "Creating..." : option.label}
              description={demoBlocked
                ? "Not available in demo mode."
                : option.description}
              selected={option.id === selectedType}
              disabled={demoBlocked || pending}
              onSelect={() => handleSelect(option.id)}
            />
          );
        })}
      </div>

      {demoSetupMutation.isError && (
        <Text as="p" size="2" color="red">
          {demoSetupMutation.error.message}
        </Text>
      )}
    </div>
  );
}
