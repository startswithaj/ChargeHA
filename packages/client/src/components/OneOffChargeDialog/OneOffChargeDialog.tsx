import { useState } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  Select,
  Text,
} from "@radix-ui/themes";
import type {
  OneOffChargeFormData,
  Schedule,
  VehicleChargeState,
  VehicleMode,
} from "@chargeha/shared";
import {
  formatDurationMinutes,
  ONE_OFF_DURATION_OPTIONS,
} from "@chargeha/shared/oneOffCharge";
import type { OneOffWindow } from "@chargeha/shared/oneOffCharge";
import { dayOfWeekForDate } from "@chargeha/shared/localTime";
import { TimePicker } from "../TimePicker/TimePicker.tsx";
import { ChargeSettings } from "../ScheduleDialog/ChargeSettings.tsx";
import { formatTime12h } from "../../utils/Format.ts";
import type { OneOffWarning } from "./oneOffWarnings.ts";
import { CostEstimate } from "./CostEstimate.tsx";
import { useOneOffForm } from "./useOneOffForm.ts";
import styles from "./OneOffChargeDialog.module.css";

interface OneOffChargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  vehicleName: string;
  state: VehicleChargeState;
  mode: VehicleMode;
  /** All schedules, for clash warnings and finding the pending one-off. */
  schedules: Schedule[];
  onSchedule: (
    data: OneOffChargeFormData,
  ) => Promise<string | null> | string | null;
  /** Cancel the pending one-off, when there is one. */
  onCancelPending?: (id: string) => Promise<unknown>;
}

const DAY_ABBRS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dayLabel = (date: string) =>
  DAY_NAMES[DAY_ABBRS.indexOf(dayOfWeekForDate(date))];

/** Start time picker plus the resolved window, so it's obvious whether "11:30
 *  PM" means tonight or tomorrow. */
function StartField(
  { startTime, window, onChange }: {
    startTime: string;
    window: OneOffWindow;
    onChange: (value: string) => void;
  },
) {
  return (
    <div className={styles.field}>
      <Text size="2" weight="medium">Start</Text>
      <div className={styles.timeRow}>
        <TimePicker value={startTime} onChange={onChange} />
        <Text size="2" color="gray">
          {window.isTomorrow ? "tomorrow" : "today"} ·{" "}
          {formatTime12h(startTime)} → {formatTime12h(window.endTime)}
          {window.wrapsMidnight && ` (${dayLabel(window.endDate)})`}
        </Text>
      </div>
    </div>
  );
}

function DurationField(
  { durationMinutes, onChange }: {
    durationMinutes: number;
    onChange: (value: number) => void;
  },
) {
  return (
    <div className={styles.field}>
      <Text size="2" weight="medium">Duration</Text>
      <Select.Root
        value={String(durationMinutes)}
        onValueChange={(v) => onChange(Number(v))}
      >
        <Select.Trigger />
        <Select.Content>
          {ONE_OFF_DURATION_OPTIONS.map((m) => (
            <Select.Item key={m} value={String(m)}>
              {formatDurationMinutes(m)}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </div>
  );
}

function WarningList({ warnings }: { warnings: OneOffWarning[] }) {
  return (
    <>
      {warnings.map((w) => (
        <Callout.Root key={w.id} size="1" color="orange">
          <Callout.Icon>
            <TriangleAlert size={14} />
          </Callout.Icon>
          <Callout.Text>{w.text}</Callout.Text>
        </Callout.Root>
      ))}
    </>
  );
}

function DialogFooter(
  { pendingId, saving, onCancelPending, onClose }: {
    pendingId?: string;
    saving: boolean;
    onCancelPending?: (id: string) => Promise<unknown>;
    onClose: () => void;
  },
) {
  return (
    <div className={styles.footer}>
      {pendingId && onCancelPending && (
        <>
          <Button
            type="button"
            variant="soft"
            color="red"
            disabled={saving}
            onClick={async () => {
              await onCancelPending(pendingId);
              onClose();
            }}
          >
            Cancel charge
          </Button>
          <span className={styles.footerSpacer} />
        </>
      )}
      <Button type="button" variant="soft" color="gray" onClick={onClose}>
        Close
      </Button>
      <Button type="submit" disabled={saving}>
        {pendingId ? "Update charge" : "Schedule charge"}
      </Button>
    </div>
  );
}

export function OneOffChargeDialog({
  open,
  onOpenChange,
  vehicleId,
  vehicleName,
  state,
  mode,
  schedules,
  onSchedule,
  onCancelPending,
}: OneOffChargeDialogProps) {
  const {
    form,
    updateField,
    window,
    estimate,
    warnings,
    pending,
    currencySymbol,
  } = useOneOffForm({ open, vehicleId, state, mode, schedules });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const err = await onSchedule(form);
      if (err) setError(err);
      else onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>
          <CalendarClock
            size={16}
            style={{ verticalAlign: "-2px", marginRight: 6 }}
          />
          Schedule a charge
        </Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          {pending
            ? `Replaces the charge already scheduled for ${vehicleName}.`
            : `A one-off charge for ${vehicleName}. Runs once, then clears itself.`}
        </Dialog.Description>

        <form onSubmit={handleSubmit} className={styles.form}>
          <StartField
            startTime={form.startTime}
            window={window}
            onChange={(v) => updateField("startTime", v)}
          />
          <DurationField
            durationMinutes={form.durationMinutes}
            onChange={(v) => updateField("durationMinutes", v)}
          />
          <ChargeSettings
            chargeAmps={form.chargeAmps}
            chargeLimitPct={form.chargeLimitPct}
            maxAmps={state.chargeAmpsMax}
            minAmps={state.chargeAmpsMin}
            updateField={updateField}
          />

          <WarningList warnings={warnings} />

          {mode !== "auto" && (
            <Text as="label" size="2">
              <Checkbox
                checked={form.switchToAuto}
                onCheckedChange={(checked) =>
                  updateField("switchToAuto", checked === true)}
                mr="2"
              />
              Switch this vehicle to Auto when saving
            </Text>
          )}

          <CostEstimate estimate={estimate} currencySymbol={currencySymbol} />

          {error && <Text size="2" color="red">{error}</Text>}

          <DialogFooter
            pendingId={pending?.id}
            saving={saving}
            onCancelPending={onCancelPending}
            onClose={() => onOpenChange(false)}
          />
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
