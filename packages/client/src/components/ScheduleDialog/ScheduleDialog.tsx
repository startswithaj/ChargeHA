import { useEffect, useState } from "react";
import { Button, Card, Text } from "@radix-ui/themes";
import type {
  DayOfWeek,
  Schedule,
  ScheduleFormData,
  ScheduleType,
} from "@chargeha/shared";
import { DayPicker } from "../DayPicker/DayPicker.tsx";
import { TimePicker } from "../TimePicker/TimePicker.tsx";
import { ChargeSettings } from "./ChargeSettings.tsx";
import styles from "./ScheduleDialog.module.css";

interface ScheduleFormProps {
  editingSchedule: Schedule | null;
  scheduleType: ScheduleType;
  vehicleId: string | null;
  maxAmps?: number; // Vehicle's max amps capability, defaults to 32
  defaultStartTime?: string; // Suggested start for new schedules (HH:MM)
  defaultEndTime?: string; // Suggested end for new schedules (HH:MM)
  onSave: (data: ScheduleFormData) => Promise<string | null> | string | null; // Returns error string or null
  onCancel: () => void;
}

const DEFAULT_FORM: ScheduleFormData = {
  scheduleType: "charge",
  vehicleId: null,
  startTime: "00:00",
  endTime: "06:00",
  days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  chargeAmps: 32,
  chargeLimitPct: 80,
};

function useInitForm(
  editingSchedule: Schedule | null,
  scheduleType: ScheduleType,
  vehicleId: string | null,
  defaultStartTime: string | undefined,
  defaultEndTime: string | undefined,
  setForm: (f: ScheduleFormData) => void,
  setError: (e: string | null) => void,
) {
  useEffect(() => {
    setError(null);
    if (editingSchedule) {
      setForm({
        scheduleType: editingSchedule.scheduleType,
        vehicleId: editingSchedule.vehicleId,
        startTime: editingSchedule.startTime,
        endTime: editingSchedule.endTime,
        days: [...editingSchedule.days],
        chargeAmps: editingSchedule.scheduleType === "charge"
          ? editingSchedule.chargeAmps
          : 32,
        chargeLimitPct: editingSchedule.scheduleType === "charge"
          ? editingSchedule.chargeLimitPct
          : 80,
      });
    } else {
      setForm({
        ...DEFAULT_FORM,
        scheduleType,
        vehicleId,
        ...(defaultStartTime && { startTime: defaultStartTime }),
        ...(defaultEndTime && { endTime: defaultEndTime }),
      });
    }
  }, [
    editingSchedule,
    scheduleType,
    vehicleId,
    defaultStartTime,
    defaultEndTime,
  ]);
}

export function ScheduleForm({
  editingSchedule,
  scheduleType,
  vehicleId,
  maxAmps = 32,
  defaultStartTime,
  defaultEndTime,
  onSave,
  onCancel,
}: ScheduleFormProps) {
  const [form, setForm] = useState<ScheduleFormData>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);

  // Initialize form on mount or when editing target changes
  useInitForm(
    editingSchedule,
    scheduleType,
    vehicleId,
    defaultStartTime,
    defaultEndTime,
    setForm,
    setError,
  );

  const updateField = <K extends keyof ScheduleFormData>(
    key: K,
    value: ScheduleFormData[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.days.length === 0) {
      setError("Select at least one day.");
      return;
    }

    const err = await onSave(form);
    if (err) {
      setError(err);
    } else {
      onCancel();
    }
  };

  const isEditing = editingSchedule !== null;
  const isCharge = form.scheduleType === "charge";

  return (
    <Card
      className={styles.formCard}
      style={{
        "--accent": isCharge
          ? "var(--color-charging)"
          : "var(--color-grid-import)",
      } as React.CSSProperties}
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        {/* Time range */}
        <div className={styles.field}>
          <Text size="2" weight="medium">Time Range</Text>
          <div className={styles.timeRow}>
            <TimePicker
              value={form.startTime}
              onChange={(v) => updateField("startTime", v)}
            />
            <Text size="2" color="gray">to</Text>
            <TimePicker
              value={form.endTime}
              onChange={(v) => updateField("endTime", v)}
            />
          </div>
        </div>

        {/* Days */}
        <div className={styles.field}>
          <Text size="2" weight="medium">Days</Text>
          <DayPicker
            value={form.days}
            onChange={(days) => updateField("days", days as DayOfWeek[])}
          />
        </div>

        {/* Charge settings (charge only) */}
        {isCharge && (
          <ChargeSettings
            chargeAmps={form.chargeAmps}
            chargeLimitPct={form.chargeLimitPct}
            maxAmps={maxAmps}
            updateField={updateField}
          />
        )}

        {/* Validation error */}
        {error && (
          <div className={styles.error}>
            <Text size="2" color="red">{error}</Text>
          </div>
        )}

        {/* Actions */}
        <div className={styles.footer}>
          <Button type="button" variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">
            {isEditing ? "Save Changes" : "Create Schedule"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
