import type { ReactNode } from "react";
import { Badge, Button, Card, Text } from "@radix-ui/themes";
import { Save } from "lucide-react";
import type { SaveStatus } from "../../hooks/useSectionConfig.ts";
import styles from "./Section.module.css";

export interface SectionProps {
  icon: ReactNode;
  title: string;
  badge?: string;
  description: string;
  action?: ReactNode;
  saveStatus?: SaveStatus;
  isDirty?: boolean;
  onSave?: () => void;
  children: ReactNode;
}

export function Section({
  icon,
  title,
  badge,
  description,
  action,
  saveStatus,
  isDirty,
  onSave,
  children,
}: SectionProps) {
  const cardClassMap: Record<string, string | undefined> = {
    saved: styles.savedCard,
    error: styles.errorCard,
  };
  const cardClass = cardClassMap[saveStatus?.state ?? ""] ??
    (isDirty ? styles.dirtyCard : undefined);

  return (
    <Card className={cardClass}>
      <div className={styles.wrapper}>
        <div>
          <div className={styles.header}>
            <span className={styles.icon}>{icon}</span>
            <Text size="3" weight="bold">{title}</Text>
            {badge && (
              <Badge variant="outline" color="orange" size="1">{badge}</Badge>
            )}
            {saveStatus?.state === "saved" && (
              <Badge
                color="green"
                variant="solid"
                size="1"
                className={styles.savedBadge}
              >
                Saved
              </Badge>
            )}
            {saveStatus?.state === "saving" && (
              <Badge color="gray" variant="soft" size="1">Saving...</Badge>
            )}
            {(action || (isDirty && onSave)) && (
              <div className={styles.action}>
                {action}
                {isDirty && onSave && (
                  <Button
                    size="1"
                    variant="solid"
                    onClick={onSave}
                    disabled={saveStatus?.state === "saving"}
                  >
                    <Save size={12} />
                    Save
                  </Button>
                )}
              </div>
            )}
          </div>
          <Text size="2" color="gray">{description}</Text>
          {saveStatus?.state === "error" && (
            <Text
              size="2"
              color="red"
              weight="medium"
              style={{ display: "block", marginTop: 4 }}
            >
              {saveStatus.message}
            </Text>
          )}
        </div>
        <div className={styles.body}>
          {children}
        </div>
      </div>
    </Card>
  );
}
