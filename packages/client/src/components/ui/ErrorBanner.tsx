import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Text } from "@radix-ui/themes";
import styles from "./ErrorBanner.module.css";

interface ErrorBannerProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

export function ErrorBanner(
  { title, description, children }: ErrorBannerProps,
) {
  return (
    <div className={styles.banner}>
      <div className={styles.header}>
        <AlertTriangle size={16} className={styles.icon} />
        <Text size="2" weight="bold">{title}</Text>
      </div>
      {description && (
        <Text size="2" color="gray" style={{ lineHeight: 1.5 }}>
          {description}
        </Text>
      )}
      {children}
    </div>
  );
}
