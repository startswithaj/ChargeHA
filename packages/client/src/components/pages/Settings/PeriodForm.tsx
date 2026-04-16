import { Button, Text, TextField } from "@radix-ui/themes";
import { TimePicker } from "../../TimePicker/TimePicker.tsx";
import { DaySelector } from "./DaySelector.tsx";
import type { PeriodFormData } from "./tariffUtils.ts";

export function PeriodForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  error,
  hasOverlaps,
  currencySymbol,
}: {
  form: PeriodFormData;
  onChange: (form: PeriodFormData) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  error: string | null;
  hasOverlaps: boolean;
  currencySymbol: string;
}) {
  const rate = parseFloat(form.ratePerKwh);
  const hasLabel = form.label.trim() !== "";
  const hasValidTimes = /^\d{2}:\d{2}$/.test(form.startTime) &&
    /^\d{2}:\d{2}$/.test(form.endTime);
  const hasValidRate = !isNaN(rate) && rate >= 0;
  const isValid = hasLabel && hasValidTimes && form.days.length > 0 &&
    hasValidRate;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 12,
        borderRadius: 6,
        background: "var(--gray-a2)",
        border: "1px solid var(--gray-a5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text size="2" style={{ minWidth: 50 }}>Label</Text>
        <TextField.Root
          size="2"
          placeholder="e.g. Off-Peak"
          value={form.label}
          onChange={(e) => onChange({ ...form, label: e.target.value })}
          style={{ flex: 1 }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Text size="2" style={{ minWidth: 50 }}>Time</Text>
        <TimePicker
          value={form.startTime}
          onChange={(value) => onChange({ ...form, startTime: value })}
        />
        <Text size="2" color="gray">to</Text>
        <TimePicker
          value={form.endTime}
          onChange={(value) => onChange({ ...form, endTime: value })}
        />
        <Text size="2" style={{ minWidth: 40, marginLeft: 8 }}>Rate</Text>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <TextField.Root
            size="2"
            type="number"
            min={0}
            step={0.01}
            placeholder="0.00"
            value={form.ratePerKwh}
            onChange={(e) => onChange({ ...form, ratePerKwh: e.target.value })}
            style={{ width: 80 }}
          />
          <Text size="2" color="gray">{currencySymbol}/kWh</Text>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Text size="2" style={{ minWidth: 50, paddingTop: 4 }}>Days</Text>
        <DaySelector
          days={form.days}
          onChange={(days) => onChange({ ...form, days })}
        />
      </div>

      {error && <Text size="2" color="red">{error}</Text>}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button size="2" disabled={!isValid || hasOverlaps} onClick={onSubmit}>
          {submitLabel}
        </Button>
        <Button size="2" variant="soft" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
