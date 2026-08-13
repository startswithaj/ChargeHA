import { Text } from "@radix-ui/themes";
import styles from "./steps.module.css";
import type { ReactNode } from "react";

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
        if (e.key !== "Enter" && e.key !== " ") return;
        // Already the chosen card? Let Enter through to the wizard, which
        // advances. Clicking a card leaves focus on it, so re-selecting would
        // be a keypress that visibly does nothing. Space still only selects.
        if (selected && e.key === "Enter") return;
        // Claim the key otherwise, so the same press cannot both pick a card
        // and move off the step.
        e.preventDefault();
        select();
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
