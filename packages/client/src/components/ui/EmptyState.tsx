import type { ReactNode } from "react";
import { Card, Text } from "@radix-ui/themes";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon: ReactNode;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <Card className={styles.card}>
      <div className={styles.content}>
        <span className={styles.icon}>{icon}</span>
        <Text size="2" color="gray">{message}</Text>
        {action}
      </div>
    </Card>
  );
}
