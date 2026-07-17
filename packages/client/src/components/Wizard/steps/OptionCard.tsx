import { Text } from "@radix-ui/themes";
import styles from "./steps.module.css";
import type { ReactNode } from "react";

/** A selectable card on a wizard selection step. */
export function OptionCard(
  { icon, title, description, selected, disabled, onSelect }: {
    icon: ReactNode;
    title: string;
    description: string;
    selected?: boolean;
    disabled?: boolean;
    onSelect: () => void;
  },
) {
  const select = () => {
    if (!disabled) onSelect();
  };

  return (
    <div
      className={`${styles.optionCard} ${
        selected ? styles.optionCardSelected : ""
      }`}
      role="button"
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") select();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {icon}
        <Text weight="bold">{title}</Text>
      </div>
      <Text size="2" color="gray">{description}</Text>
    </div>
  );
}
