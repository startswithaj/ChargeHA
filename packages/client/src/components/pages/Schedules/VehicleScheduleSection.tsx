import { Car, Clock, Plus } from "lucide-react";
import { Badge, Button, Text } from "@radix-ui/themes";
import type {
  ChargeSchedule,
  Schedule,
  ScheduleFormData,
} from "@chargeha/shared";
import type { VehicleWithState } from "@chargeha/shared";
import { ScheduleCard } from "../../ScheduleCard/ScheduleCard.tsx";
import { ScheduleForm } from "../../ScheduleDialog/ScheduleDialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import styles from "./Schedules.module.css";

interface VehicleScheduleSectionProps {
  vehicle: VehicleWithState;
  vehicleSchedules: ChargeSchedule[];
  showingForm: boolean;
  gap: { startTime: string; endTime: string };
  editingScheduleId: string | null;
  isCreating: boolean;
  onAddSchedule: (vehicleId: string) => void;
  onSave: (data: ScheduleFormData) => Promise<string | null>;
  onCancel: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (schedule: Schedule) => void;
  onDelete: (id: string) => void;
}

export function VehicleScheduleSection({
  vehicle,
  vehicleSchedules,
  showingForm,
  gap,
  editingScheduleId,
  isCreating,
  onAddSchedule,
  onSave,
  onCancel,
  onToggle,
  onEdit,
  onDelete,
}: VehicleScheduleSectionProps) {
  return (
    <div className={styles.vehicleSection}>
      <div className={styles.sectionHeader}>
        <div className={styles.vehicleLabel}>
          <Car size={16} style={{ color: "var(--color-vehicle)" }} />
          <Text size="3" weight="medium">{vehicle.name}</Text>
          <Badge variant="outline" size="1">
            {vehicle.adapterType}
          </Badge>
        </div>
        {!showingForm && (
          <Button
            variant="soft"
            size="1"
            onClick={() => onAddSchedule(vehicle.id)}
          >
            <Plus size={14} />
            Add Schedule
          </Button>
        )}
      </div>

      {/* Existing schedules */}
      {vehicleSchedules.length === 0 && !showingForm && (
        <EmptyState
          icon={<Clock size={20} />}
          message="No charge schedules for this vehicle."
        />
      )}

      <div className={styles.scheduleList}>
        {vehicleSchedules.map((s) => {
          // If editing this schedule, show inline form instead
          if (editingScheduleId === s.id) {
            return (
              <ScheduleForm
                key={`edit-${s.id}`}
                editingSchedule={s}
                scheduleType="charge"
                vehicleId={vehicle.id}
                onSave={onSave}
                onCancel={onCancel}
              />
            );
          }
          return (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          );
        })}
      </div>

      {/* Inline create form for this vehicle */}
      {isCreating && (
        <ScheduleForm
          editingSchedule={null}
          scheduleType="charge"
          vehicleId={vehicle.id}
          defaultStartTime={gap.startTime}
          defaultEndTime={gap.endTime}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}
