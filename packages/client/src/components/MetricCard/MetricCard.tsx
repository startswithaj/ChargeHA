import type { ReactNode } from "react";
import { Card, Skeleton, Text } from "@radix-ui/themes";
import styles from "./MetricCard.module.css";

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  accentColor: string;
  loading?: boolean;
  subtitle?: string;
  /** Use a smaller font for the value (e.g. when displaying text instead of a number). */
  smallValue?: boolean;
}

export function MetricCard({
  icon,
  label,
  value,
  accentColor,
  loading = false,
  subtitle,
  smallValue = false,
}: MetricCardProps) {
  return (
    <Card
      className={styles.card}
      style={{ "--accent": accentColor } as React.CSSProperties}
    >
      <div className={styles.header}>
        <div className={styles.icon} style={{ color: accentColor }}>
          {icon}
        </div>
        <Text size="2" color="gray">
          {label}
        </Text>
      </div>
      <div className={styles.value}>
        {loading
          ? <Skeleton width="80px" height="32px" />
          : <Text size={smallValue ? "3" : "7"} weight="bold">{value}</Text>}
      </div>
      {subtitle && (
        <Text size="1" color="gray" className={styles.subtitle}>
          {subtitle}
        </Text>
      )}
    </Card>
  );
}
