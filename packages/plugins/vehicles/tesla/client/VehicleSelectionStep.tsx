import { useCallback, useEffect, useRef, useState } from "react";
import { Callout, Checkbox, Text, TextField } from "@radix-ui/themes";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import type { StepProps } from "../../../../client/src/components/Wizard/WizardShell.tsx";
import {
  hintUnlessLoading,
  useWizardNextControl,
} from "../../../../client/src/components/Wizard/wizardNextControl.ts";
import styles from "../../../../client/src/components/Wizard/steps/steps.module.css";

type DiscoveredVehicle = { vin: string; name: string; state: string };

function VehicleRow(
  {
    vehicle,
    selected,
    multiVehicle,
    priority,
    toggleVehicle,
    onPriorityChange,
  }: {
    vehicle: DiscoveredVehicle;
    selected: boolean;
    multiVehicle: boolean;
    priority: number;
    toggleVehicle: (vin: string) => void;
    onPriorityChange: (vin: string, value: string) => void;
  },
) {
  return (
    <div
      className={`${styles.vehicleRow} ${
        selected ? styles.vehicleRowSelected : ""
      }`}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => toggleVehicle(vehicle.vin)}
        aria-label={`Select ${vehicle.name}`}
      />
      <div className={styles.vehicleInfo}>
        <Text weight="medium">{vehicle.name}</Text>
        <Text size="1" color="gray">VIN: {vehicle.vin}</Text>
        <Text size="1" color="gray">Battery: —</Text>
      </div>
      {multiVehicle && (
        <div className={styles.priorityInput}>
          <Text size="1" color="gray">Priority</Text>
          <TextField.Root
            type="number"
            value={String(priority)}
            onChange={(e: { target: { value: string } }) =>
              onPriorityChange(vehicle.vin, e.target.value)}
            style={{ width: 60 }}
            aria-label={`Priority for ${vehicle.name}`}
          />
        </div>
      )}
    </div>
  );
}

function useInitializeSelection(
  { vehicles, initialized, setSelected, setPriorities }: {
    vehicles: DiscoveredVehicle[];
    initialized: React.MutableRefObject<boolean>;
    setSelected: (s: Set<string>) => void;
    setPriorities: (p: Record<string, number>) => void;
  },
) {
  useEffect(() => {
    if (vehicles.length > 0 && !initialized.current) {
      initialized.current = true;
      setSelected(new Set(vehicles.map((v) => v.vin)));
      setPriorities(
        Object.fromEntries(vehicles.map((v, i) => [v.vin, i + 1])),
      );
    }
  }, [vehicles]);
}

function useSelectionCallbacks(
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
  setPriorities: React.Dispatch<React.SetStateAction<Record<string, number>>>,
) {
  const toggleVehicle = useCallback((vin: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vin)) next.delete(vin);
      else next.add(vin);
      return next;
    });
  }, []);
  const handlePriorityChange = useCallback((vin: string, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num > 0) {
      setPriorities((prev) => ({ ...prev, [vin]: num }));
    }
  }, []);
  return { toggleVehicle, handlePriorityChange };
}

function StatusCallouts(
  { existingVehiclesPresent, loading, error, emptyResult }: {
    existingVehiclesPresent: boolean;
    loading: boolean;
    error: string | null;
    emptyResult: boolean;
  },
) {
  return (
    <>
      {existingVehiclesPresent && (
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircle size={16} />
          </Callout.Icon>
          <Callout.Text>Vehicles are already configured.</Callout.Text>
        </Callout.Root>
      )}
      {loading && (
        <Callout.Root color="blue">
          <Callout.Icon>
            <Loader2 size={16} className={styles.spinner} />
          </Callout.Icon>
          <Callout.Text>Discovering vehicles...</Callout.Text>
        </Callout.Root>
      )}
      {error && (
        <Callout.Root color="red">
          <Callout.Icon>
            <AlertCircle size={16} />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {emptyResult && (
        <Callout.Root color="orange">
          <Callout.Text>
            No vehicles found on your Tesla account.
          </Callout.Text>
        </Callout.Root>
      )}
    </>
  );
}

async function saveSelectedVehicles(
  { selectedVehicles, priorities, utils }: {
    selectedVehicles: DiscoveredVehicle[];
    priorities: Record<string, number>;
    utils: ReturnType<typeof trpc.useUtils>;
  },
) {
  await selectedVehicles.reduce(
    (chain, vehicle) =>
      chain.then(async () => {
        await utils.client.tesla.selectVehicle.mutate({
          vin: vehicle.vin,
          name: vehicle.name,
        });
        if (selectedVehicles.length > 1) {
          await utils.client.vehicle.setPriority.mutate({
            vehicleId: vehicle.vin,
            priority: priorities[vehicle.vin] ?? 1,
          });
        }
      }),
    Promise.resolve(),
  );
}

export function VehicleSelectionStep(_props: StepProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const initialized = useRef(false);
  const utils = trpc.useUtils();

  // Check if vehicles are already configured in the DB
  const existingVehiclesQuery = trpc.vehicle.list.useQuery();
  const existingVehicles = existingVehiclesQuery.data?.vehicles ?? [];

  const {
    data: vehiclesData,
    isLoading: loading,
    error: queryError,
  } = trpc.tesla.teslaVehicles.useQuery();

  const vehicles: Array<{ vin: string; name: string; state: string }> =
    vehiclesData?.vehicles ?? [];

  useInitializeSelection({
    vehicles,
    initialized,
    setSelected,
    setPriorities,
  });
  const { toggleVehicle, handlePriorityChange } = useSelectionCallbacks(
    setSelected,
    setPriorities,
  );

  const handleBeforeNext = async (): Promise<boolean> => {
    if (selected.size === 0) {
      // Nothing newly selected — advance only if vehicles already exist.
      return existingVehicles.length > 0;
    }
    setSaveError(null);
    try {
      await saveSelectedVehicles({
        selectedVehicles: vehicles.filter((v) => selected.has(v.vin)),
        priorities,
        utils,
      });
      // The pairing step reads vehicle.list — drop the pre-save cache.
      await utils.vehicle.list.invalidate();
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
      return false;
    }
  };

  useWizardNextControl({
    canProceed: selected.size > 0 || existingVehicles.length > 0,
    hint: hintUnlessLoading(
      loading || existingVehiclesQuery.isLoading,
      selectionHint(selected.size, existingVehicles.length),
    ),
    pendingLabel: "Saving...",
    onBeforeNext: handleBeforeNext,
  });

  const error = queryError?.message ?? saveError ?? null;
  const multiVehicle = selected.size > 1;

  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        Select the vehicles you want ChargeHA to manage. The vehicles below were
        found on your Tesla account.
      </Text>

      <StatusCallouts
        existingVehiclesPresent={existingVehicles.length > 0}
        loading={loading}
        error={error}
        emptyResult={!loading && !error && vehicles.length === 0}
      />

      {!loading && vehicles.length > 0 && (
        <div className={styles.vehicleList}>
          {vehicles.map((vehicle) => (
            <VehicleRow
              key={vehicle.vin}
              vehicle={vehicle}
              selected={selected.has(vehicle.vin)}
              multiVehicle={multiVehicle}
              priority={priorities[vehicle.vin] ?? 1}
              toggleVehicle={toggleVehicle}
              onPriorityChange={handlePriorityChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function selectionHint(selectedCount: number, existingCount: number): string {
  if (selectedCount > 0) return "Next saves the selected vehicles";
  if (existingCount > 0) return "Vehicles already configured — Next continues";
  return "Select at least one vehicle to continue";
}
