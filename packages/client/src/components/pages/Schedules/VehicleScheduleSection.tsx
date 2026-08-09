import { Car, Clock, Plus, Zap } from "lucide-react";
import { Badge, Button, Text } from "@radix-ui/themes";
import type {
  ChargeSchedule,
  Schedule,
  ScheduleFormData,
} from "@chargeha/shared";
import { ScheduleCard } from "../../ScheduleCard/ScheduleCard.tsx";
import { ScheduleForm } from "../../ScheduleDialog/ScheduleDialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { type ScheduleNotice, ScheduleNoticeCard } from "./ScheduleNotice.tsx";
import styles from "./Schedules.module.css";

export interface ScheduleTarget {
  kind: "vehicle" | "charger";
  id: string;
  name: string;
  badge: string;
  /** The charge point's own id (e.g. an OCPP charge point id), when its
   *  plugin advertises one. Two chargers of the same type are otherwise
   *  indistinguishable in this heading. */
  identifier: string | null;
}

interface TargetScheduleSectionProps {
  target: ScheduleTarget;
  targetSchedules: ChargeSchedule[];
  notices: ScheduleNotice[];
  showingForm: boolean;
  gap: { startTime: string; endTime: string };
  editingScheduleId: string | null;
  isCreating: boolean;
  onAddSchedule: () => void;
  onSave: (data: ScheduleFormData) => Promise<string | null>;
  onCancel: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (schedule: Schedule) => void;
  onDelete: (id: string) => void;
}

function TargetHeading({ target }: { target: ScheduleTarget }) {
  const isVehicle = target.kind === "vehicle";
  return (
    <div className={styles.vehicleLabel}>
      {isVehicle
        ? <Car size={16} style={{ color: "var(--color-vehicle)" }} />
        : <Zap size={16} style={{ color: "var(--color-charging)" }} />}
      <Text size="3" weight="medium">{target.name}</Text>
      {target.identifier !== null && (
        <Badge variant="soft" size="1" title="Charge point id">
          {target.identifier}
        </Badge>
      )}
      {
        /* A row named after its adapter already says its type; repeating it in
          the badge tells the user nothing about which charger this is. */
      }
      {target.badge !== target.name && (
        <Badge variant="outline" size="1">{target.badge}</Badge>
      )}
    </div>
  );
}

export function TargetScheduleSection({
  target,
  targetSchedules,
  notices,
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
}: TargetScheduleSectionProps) {
  const isVehicle = target.kind === "vehicle";
  const formVehicleId = isVehicle ? target.id : null;
  const formChargerId = isVehicle ? null : target.id;

  return (
    <div className={styles.vehicleSection}>
      <div className={styles.sectionHeader}>
        <TargetHeading target={target} />
        {!showingForm && (
          <Button
            variant="soft"
            size="1"
            onClick={onAddSchedule}
          >
            <Plus size={14} />
            Add Schedule
          </Button>
        )}
      </div>

      {notices.map((notice) => (
        <ScheduleNoticeCard key={notice.id} notice={notice} />
      ))}

      {/* Existing schedules */}
      {targetSchedules.length === 0 && !showingForm && (
        <EmptyState
          icon={<Clock size={20} />}
          message={isVehicle
            ? "No charge schedules for this vehicle."
            : "No charge schedules for this charger."}
        />
      )}

      <div className={styles.scheduleList}>
        {targetSchedules.map((s) => {
          // If editing this schedule, show inline form instead
          if (editingScheduleId === s.id) {
            return (
              <ScheduleForm
                key={`edit-${s.id}`}
                editingSchedule={s}
                scheduleType="charge"
                vehicleId={formVehicleId}
                chargerId={formChargerId}
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

      {/* Inline create form for this target */}
      {isCreating && (
        <ScheduleForm
          editingSchedule={null}
          scheduleType="charge"
          vehicleId={formVehicleId}
          chargerId={formChargerId}
          defaultStartTime={gap.startTime}
          defaultEndTime={gap.endTime}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}
