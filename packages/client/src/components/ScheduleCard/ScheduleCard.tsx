import { Pencil, Trash2 } from "lucide-react";
import { Card, IconButton, Switch, Text } from "@radix-ui/themes";
import type { Schedule } from "@chargeha/shared";
import { formatDays, formatTime12h } from "../../utils/Format.ts";
import styles from "./ScheduleCard.module.css";

interface ScheduleCardProps {
  schedule: Schedule;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (schedule: Schedule) => void;
  onDelete: (id: string) => void;
}

export function ScheduleCard({
  schedule,
  onToggle,
  onEdit,
  onDelete,
}: ScheduleCardProps) {
  const isCharge = schedule.scheduleType === "charge";
  const accentColor = isCharge
    ? "var(--color-charging)"
    : "var(--color-grid-import)";

  const timeText = `${formatTime12h(schedule.startTime)} – ${
    formatTime12h(schedule.endTime)
  }`;

  // Calculate duration in minutes, handling overnight ranges
  const [sH, sM] = schedule.startTime.split(":").map(Number);
  const [eH, eM] = schedule.endTime.split(":").map(Number);
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;
  const totalMin = endMin > startMin
    ? endMin - startMin
    : 1440 - startMin + endMin;
  const durH = Math.floor(totalMin / 60);
  const durM = totalMin % 60;
  const durationText = (() => {
    if (durH > 0 && durM > 0) return `${durH}h ${durM}m`;
    if (durH > 0) return `${durH}h`;
    return `${durM}m`;
  })();

  const daysText = formatDays(schedule.days);

  const detailText = isCharge
    ? `Charge at ${schedule.chargeAmps}A to ${schedule.chargeLimitPct}%`
    : "Stop all charging";

  return (
    <Card
      className={styles.card}
      data-disabled={!schedule.enabled}
      style={{ "--accent": accentColor } as React.CSSProperties}
    >
      <div className={styles.row}>
        <Switch
          size="2"
          checked={schedule.enabled}
          onCheckedChange={(checked) => onToggle(schedule.id, checked)}
        />
        <div className={styles.info}>
          <div className={styles.timeRow}>
            <Text size="2" weight="bold">{timeText}</Text>
            <Text size="1" color="gray">({durationText})</Text>
            <Text size="1" color="gray">{daysText}</Text>
          </div>
          <Text size="1" color="gray">{detailText}</Text>
        </div>
        <div className={styles.actions}>
          <IconButton
            variant="soft"
            size="1"
            aria-label="Edit schedule"
            onClick={() => onEdit(schedule)}
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            variant="soft"
            color="red"
            size="1"
            aria-label="Delete schedule"
            onClick={() => onDelete(schedule.id)}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
    </Card>
  );
}
