import { Badge, Button, IconButton, Text } from "@radix-ui/themes";
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import type { TariffPeriod } from "./TariffSettings.tsx";
import { formatRate } from "../../../utils/Format.ts";
import { PeriodForm } from "./PeriodForm.tsx";
import {
  formatDays,
  formatGapMessage,
  formatOverlapMessage,
  type GapWarning,
  type OverlapError,
  type PeriodFormData,
} from "./tariffUtils.ts";

function PeriodRow(
  { period, currencySymbol, onStartEdit, onDelete }: {
    period: TariffPeriod;
    currencySymbol: string;
    onStartEdit: (period: TariffPeriod) => void;
    onDelete: (id: number) => void;
  },
) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 10px",
        borderRadius: 6,
        background: "var(--gray-a2)",
        opacity: period.enabled ? 1 : 0.5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
          flexWrap: "wrap",
        }}
      >
        <Text size="2" weight="bold" style={{ minWidth: 90 }}>
          {period.label}
        </Text>
        <Badge variant="outline" size="1">
          <Clock size={10} /> {period.startTime} – {period.endTime}
        </Badge>
        <Badge variant="outline" size="1" color="gray">
          {formatDays(period.days)}
        </Badge>
        <Badge color="blue" variant="soft" size="1">
          {formatRate(period.ratePerKwh, currencySymbol)}/kWh
        </Badge>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <IconButton
          variant="ghost"
          size="1"
          onClick={() => onStartEdit(period)}
        >
          <Pencil size={14} />
        </IconButton>
        <IconButton
          variant="ghost"
          color="red"
          size="1"
          onClick={() => onDelete(period.id)}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
    </div>
  );
}

function PeriodMessages(
  { hasOverlaps, overlapErrors, gapWarnings }: {
    hasOverlaps: boolean;
    overlapErrors: OverlapError[];
    gapWarnings: GapWarning[];
  },
) {
  return (
    <>
      {hasOverlaps && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--red-a2)",
            border: "1px solid var(--red-a5)",
          }}
        >
          {overlapErrors.map((overlap, i) => (
            <Text key={i} size="2" color="red" style={{ display: "block" }}>
              {formatOverlapMessage(overlap)}
            </Text>
          ))}
        </div>
      )}
      {gapWarnings.length > 0 && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--gray-a2)",
            border: "1px solid var(--gray-a5)",
          }}
        >
          {gapWarnings.map((warning, i) => (
            <Text key={i} size="2" color="gray" style={{ display: "block" }}>
              {formatGapMessage(warning)}
            </Text>
          ))}
        </div>
      )}
    </>
  );
}

export function TariffPeriodsSection({
  periods,
  editingId,
  showAddForm,
  form,
  formError,
  hasOverlaps,
  overlapErrors,
  gapWarnings,
  currencySymbol,
  onFormChange,
  onStartAdd,
  onStartEdit,
  onUpdate,
  onCancelEdit,
  onAdd,
  onCancelAdd,
  onDelete,
}: {
  periods: TariffPeriod[];
  editingId: number | null;
  showAddForm: boolean;
  form: PeriodFormData;
  formError: string | null;
  hasOverlaps: boolean;
  overlapErrors: OverlapError[];
  gapWarnings: GapWarning[];
  currencySymbol: string;
  onFormChange: (form: PeriodFormData) => void;
  onStartAdd: () => void;
  onStartEdit: (period: TariffPeriod) => void;
  onUpdate: () => void;
  onCancelEdit: () => void;
  onAdd: () => void;
  onCancelAdd: () => void;
  onDelete: (id: number) => void;
}) {
  const hasPeriods = periods.length > 0;

  return (
    <div
      style={{
        marginTop: 4,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Text size="2" weight="bold">Tariff Periods</Text>
        <Button size="1" variant="soft" onClick={onStartAdd}>
          <Plus size={14} /> Add Period
        </Button>
      </div>

      {!hasPeriods && !showAddForm && (
        <Text size="2" color="gray">
          No tariff periods configured. Add one or load a preset above.
        </Text>
      )}

      {/* Existing periods */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {periods.map((period) => {
          if (editingId === period.id) {
            return (
              <PeriodForm
                key={period.id}
                form={form}
                onChange={onFormChange}
                onSubmit={onUpdate}
                onCancel={onCancelEdit}
                submitLabel="Update"
                error={formError}
                hasOverlaps={hasOverlaps}
                currencySymbol={currencySymbol}
              />
            );
          }
          return (
            <PeriodRow
              key={period.id}
              period={period}
              currencySymbol={currencySymbol}
              onStartEdit={onStartEdit}
              onDelete={onDelete}
            />
          );
        })}
      </div>

      <PeriodMessages
        hasOverlaps={hasOverlaps}
        overlapErrors={overlapErrors}
        gapWarnings={gapWarnings}
      />

      {/* Add form */}
      {showAddForm && (
        <div style={{ marginTop: 8 }}>
          <PeriodForm
            form={form}
            onChange={onFormChange}
            onSubmit={onAdd}
            onCancel={onCancelAdd}
            submitLabel="Add Period"
            error={formError}
            hasOverlaps={hasOverlaps}
            currencySymbol={currencySymbol}
          />
        </div>
      )}
    </div>
  );
}
