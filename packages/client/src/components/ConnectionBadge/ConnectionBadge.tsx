import { Badge } from "@radix-ui/themes";
import { useConnectionStatus } from "../../hooks/useConnectionStatus.ts";
import styles from "./ConnectionBadge.module.css";

const statusConfig = {
  connected: {
    label: "LIVE",
    color: "var(--color-connected)",
    badgeColor: "green" as const,
  },
  connecting: {
    label: "CONNECTING",
    color: "var(--color-connecting)",
    badgeColor: "yellow" as const,
  },
  disconnected: {
    label: "OFFLINE",
    color: "var(--color-disconnected)",
    badgeColor: "red" as const,
  },
};

export function ConnectionBadge() {
  const status = useConnectionStatus();
  const config = statusConfig[status];

  return (
    <Badge variant="soft" color={config.badgeColor} className={styles.badge}>
      <span
        className={`${styles.dot} ${
          status === "connected" ? styles.pulse : ""
        }`}
        style={{ backgroundColor: config.color }}
      />
      {config.label}
    </Badge>
  );
}
