import { Info } from "lucide-react";
import { Card, Text } from "@radix-ui/themes";
import styles from "./Schedules.module.css";

export interface ScheduleNotice {
  id: string;
  severity: "warning" | "info";
  title: string;
  message: string;
}

/** Amber + Info is the dashboard's warning convention (WARNING_ACCENTS in
 *  EnergyOverview.tsx); the gray variant reuses this page's existing info-note
 *  border rather than inventing a third style. */
const ACCENTS = {
  warning: { border: "var(--amber-9)", icon: "var(--amber-9)" },
  info: { border: "var(--gray-a6)", icon: "var(--gray-9)" },
} as const;

export function ScheduleNoticeCard({ notice }: { notice: ScheduleNotice }) {
  const accent = ACCENTS[notice.severity];
  return (
    <Card style={{ borderLeft: `3px solid ${accent.border}` }}>
      <div className={styles.noticeRow}>
        <Info
          size={16}
          style={{ color: accent.icon, flexShrink: 0, marginTop: 2 }}
        />
        <div>
          <Text size="2" weight="bold" style={{ display: "block" }}>
            {notice.title}
          </Text>
          <Text size="2" color="gray">{notice.message}</Text>
        </div>
      </div>
    </Card>
  );
}
