import { useMemo, useState } from "react";
import { AlertTriangle, Ban, Car, Info, Plus, Settings } from "lucide-react";
import { Button, Card, Text } from "@radix-ui/themes";
import type {
  ChargeSchedule,
  Schedule,
  ScheduleFormData,
} from "@chargeha/shared";
import { vehicleScheduleNotes } from "@chargeha/plugins/componentRegistry";
import { useSchedules } from "../../../hooks/useSchedules.ts";
import { useVehicles } from "../../../hooks/useVehicles.ts";
import { useSystemConfig } from "../../../hooks/useSectionConfig.ts";
import { ScheduleCard } from "../../ScheduleCard/ScheduleCard.tsx";
import { ScheduleForm } from "../../ScheduleDialog/ScheduleDialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { findNextGap } from "./scheduleGapUtils.ts";
import { VehicleScheduleSection } from "./VehicleScheduleSection.tsx";
import styles from "./Schedules.module.css";

// Tracks which inline form is open: creating for a vehicle/blockout, or editing a schedule
type FormTarget =
  | { action: "create-charge"; vehicleId: string }
  | { action: "create-blockout" }
  | { action: "edit"; schedule: Schedule };

interface SchedulesProps {
  onNavigateSettings?: () => void;
}

function isBlockoutTarget(target: FormTarget | null): boolean {
  if (target === null) return false;
  if (target.action === "create-blockout") return true;
  return target.action === "edit" &&
    target.schedule.scheduleType === "blockout";
}

function useFormHelpers(
  { formTarget, setFormTarget, addSchedule, updateSchedule }: {
    formTarget: FormTarget | null;
    setFormTarget: (t: FormTarget | null) => void;
    addSchedule: (data: ScheduleFormData) => Promise<string | null>;
    updateSchedule: (
      id: string,
      data: ScheduleFormData,
    ) => Promise<string | null>;
  },
) {
  const closeForm = () => setFormTarget(null);

  const handleSave = (data: ScheduleFormData): Promise<string | null> => {
    if (formTarget?.action === "edit") {
      return updateSchedule(formTarget.schedule.id, data);
    }
    return addSchedule(data);
  };

  const openEdit = (schedule: Schedule) => {
    setFormTarget({ action: "edit", schedule });
  };

  const isFormForVehicle = (vehicleId: string) =>
    formTarget !== null &&
    ((formTarget.action === "create-charge" &&
      formTarget.vehicleId === vehicleId) ||
      (formTarget.action === "edit" &&
        formTarget.schedule.scheduleType === "charge" &&
        formTarget.schedule.vehicleId === vehicleId));

  const isFormForBlockout = isBlockoutTarget(formTarget);

  const editingScheduleId = formTarget?.action === "edit"
    ? formTarget.schedule.id
    : null;

  return {
    closeForm,
    handleSave,
    openEdit,
    isFormForVehicle,
    isFormForBlockout,
    editingScheduleId,
  };
}

function VehicleSections(
  {
    vehicles,
    chargeSchedules,
    schedules,
    formTarget,
    editingScheduleId,
    isFormForVehicle,
    setFormTarget,
    handleSave,
    closeForm,
    toggleSchedule,
    openEdit,
    removeSchedule,
  }: {
    vehicles: ReturnType<typeof useVehicles>["vehicles"];
    chargeSchedules: ChargeSchedule[];
    schedules: Schedule[];
    formTarget: FormTarget | null;
    editingScheduleId: string | null;
    isFormForVehicle: (vehicleId: string) => boolean;
    setFormTarget: (t: FormTarget | null) => void;
    handleSave: (data: ScheduleFormData) => Promise<string | null>;
    closeForm: () => void;
    toggleSchedule: (id: string, enabled: boolean) => void;
    openEdit: (s: Schedule) => void;
    removeSchedule: (id: string) => void;
  },
) {
  return (
    <>
      {vehicles.map((vehicle) => (
        <VehicleScheduleSection
          key={vehicle.id}
          vehicle={vehicle}
          vehicleSchedules={chargeSchedules.filter(
            (s) => s.vehicleId === vehicle.id,
          )}
          showingForm={isFormForVehicle(vehicle.id)}
          gap={findNextGap(schedules, "charge", vehicle.id)}
          editingScheduleId={editingScheduleId}
          isCreating={formTarget?.action === "create-charge" &&
            formTarget.vehicleId === vehicle.id}
          onAddSchedule={(vehicleId) =>
            setFormTarget({ action: "create-charge", vehicleId })}
          onSave={handleSave}
          onCancel={closeForm}
          onToggle={toggleSchedule}
          onEdit={openEdit}
          onDelete={removeSchedule}
        />
      ))}
    </>
  );
}

function NoVehiclesEmptyState(
  { onNavigateSettings }: { onNavigateSettings?: () => void },
) {
  return (
    <div className={styles.page}>
      <Text size="5" weight="bold">Schedules</Text>
      <Card>
        <div className={styles.noVehicles}>
          <Car size={24} style={{ color: "var(--gray-9)" }} />
          <div className={styles.noVehiclesText}>
            <Text size="3" weight="bold" style={{ display: "block" }}>
              No vehicles configured
            </Text>
            <Text size="2" color="gray">
              Add a vehicle in Settings to start creating charge and blockout
              schedules.
            </Text>
          </div>
          <Button variant="soft" size="2" onClick={onNavigateSettings}>
            <Settings size={16} />
            Add Vehicle
          </Button>
        </div>
      </Card>
    </div>
  );
}

function PageHeader(
  { timezone, activeScheduleNotes }: {
    timezone: string;
    activeScheduleNotes: Array<{ adapterType: string; text: string }>;
  },
) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.titleRow}>
        <Text size="5" weight="bold">Schedules</Text>
        <Text size="1" color="gray">Times shown in {timezone}</Text>
      </div>
      <div>
        <Text size="2" color="gray">
          Charge schedules override solar tracking and charge at the set rate
          regardless of solar production. Use these for off-peak windows where
          you want guaranteed charging.
        </Text>
      </div>
      {activeScheduleNotes.map((note) => (
        <div key={note.adapterType} className={styles.disclaimer}>
          <AlertTriangle
            size={16}
            style={{ color: "var(--amber-9)", flexShrink: 0, marginTop: 1 }}
          />
          <Text size="1" color="gray">{note.text}</Text>
        </div>
      ))}
    </div>
  );
}

function BlockoutSection(
  {
    blockoutSchedules,
    isFormForBlockout,
    editingScheduleId,
    handleSave,
    closeForm,
    toggleSchedule,
    openEdit,
    removeSchedule,
    setFormTarget,
    formTarget,
    schedules,
  }: {
    blockoutSchedules: Schedule[];
    isFormForBlockout: boolean;
    editingScheduleId: string | null;
    handleSave: (data: ScheduleFormData) => Promise<string | null>;
    closeForm: () => void;
    toggleSchedule: (id: string, enabled: boolean) => void;
    openEdit: (s: Schedule) => void;
    removeSchedule: (id: string) => void;
    setFormTarget: (t: FormTarget | null) => void;
    formTarget: FormTarget | null;
    schedules: Schedule[];
  },
) {
  return (
    <>
      <div className={styles.sectionHeader}>
        <Text size="3" weight="medium">Blockout Schedules</Text>
        {!isFormForBlockout && (
          <Button
            variant="soft"
            size="1"
            onClick={() => setFormTarget({ action: "create-blockout" })}
          >
            <Plus size={14} />
            Add Blockout Period
          </Button>
        )}
      </div>
      {blockoutSchedules.length === 0 && !isFormForBlockout && (
        <EmptyState
          icon={<Ban size={20} />}
          message="No blockout periods. Create one to prevent charging during peak tariff hours."
        />
      )}
      <div className={styles.scheduleList}>
        {blockoutSchedules.map((s) => {
          if (editingScheduleId === s.id) {
            return (
              <ScheduleForm
                key={`edit-${s.id}`}
                editingSchedule={s}
                scheduleType="blockout"
                vehicleId={null}
                onSave={handleSave}
                onCancel={closeForm}
              />
            );
          }
          return (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onToggle={toggleSchedule}
              onEdit={openEdit}
              onDelete={removeSchedule}
            />
          );
        })}
      </div>
      {formTarget?.action === "create-blockout" && (
        <ScheduleForm
          editingSchedule={null}
          scheduleType="blockout"
          vehicleId={null}
          defaultStartTime={findNextGap(schedules, "blockout", null).startTime}
          defaultEndTime={findNextGap(schedules, "blockout", null).endTime}
          onSave={handleSave}
          onCancel={closeForm}
        />
      )}
    </>
  );
}

export function Schedules({ onNavigateSettings }: SchedulesProps) {
  const { vehicles, loading: vehiclesLoading } = useVehicles();
  const {
    schedules,
    chargeSchedules,
    blockoutSchedules,
    addSchedule,
    updateSchedule,
    toggleSchedule,
    removeSchedule,
  } = useSchedules();

  // Show schedule notes only for vehicle adapter types the user has
  const activeScheduleNotes = useMemo(() => {
    const adapterTypes = new Set(vehicles.map((v) => v.adapterType));
    return vehicleScheduleNotes.filter((n) => adapterTypes.has(n.adapterType));
  }, [vehicles]);

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);

  // Configured zone schedules are evaluated in (reactive); else the browser's.
  const { data: systemConfig } = useSystemConfig();
  const timezone = systemConfig?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  const {
    closeForm,
    handleSave,
    openEdit,
    isFormForVehicle,
    isFormForBlockout,
    editingScheduleId,
  } = useFormHelpers({
    formTarget,
    setFormTarget,
    addSchedule,
    updateSchedule,
  });

  if (!vehiclesLoading && vehicles.length === 0) {
    return <NoVehiclesEmptyState onNavigateSettings={onNavigateSettings} />;
  }

  // Loading state
  if (vehiclesLoading) {
    return (
      <div className={styles.page}>
        <Text size="5" weight="bold">Schedules</Text>
        <Text size="2" color="gray">Loading...</Text>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        timezone={timezone}
        activeScheduleNotes={activeScheduleNotes}
      />

      <VehicleSections
        vehicles={vehicles}
        chargeSchedules={chargeSchedules}
        schedules={schedules}
        formTarget={formTarget}
        editingScheduleId={editingScheduleId}
        isFormForVehicle={isFormForVehicle}
        setFormTarget={setFormTarget}
        handleSave={handleSave}
        closeForm={closeForm}
        toggleSchedule={toggleSchedule}
        openEdit={openEdit}
        removeSchedule={removeSchedule}
      />

      {/* Separator */}
      <div className={styles.separator} />

      <BlockoutSection
        blockoutSchedules={blockoutSchedules}
        isFormForBlockout={isFormForBlockout}
        editingScheduleId={editingScheduleId}
        handleSave={handleSave}
        closeForm={closeForm}
        toggleSchedule={toggleSchedule}
        openEdit={openEdit}
        removeSchedule={removeSchedule}
        setFormTarget={setFormTarget}
        formTarget={formTarget}
        schedules={schedules}
      />

      {/* Info note */}
      <Card className={styles.infoCard}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Info
            size={16}
            style={{ color: "var(--gray-9)", flexShrink: 0, marginTop: 2 }}
          />
          <Text size="1" color="gray">
            Outside of scheduled windows, vehicles in Auto mode will charge
            based on excess solar production. Blockout schedules take priority
            over charge schedules — if a blockout is active, charging will not
            start regardless of other settings.
          </Text>
        </div>
      </Card>
    </div>
  );
}
