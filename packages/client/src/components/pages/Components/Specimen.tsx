import type { ReactNode } from "react";
import { Text } from "@radix-ui/themes";
import { Section } from "../../ui/Section.tsx";
import styles from "./Components.module.css";

export function Specimen(
  { label, children }: { label: string; children: ReactNode },
) {
  return (
    <div className={styles.specimen}>
      <span className={styles.specimenLabel}>{label}</span>
      <div className={styles.specimenBody}>{children}</div>
    </div>
  );
}

/** Stacks its children — for full-width rows, cards and banners. */
export function StackedSpecimen(
  { label, children }: { label: string; children: ReactNode },
) {
  return (
    <div className={styles.specimen}>
      <span className={styles.specimenLabel}>{label}</span>
      <div className={styles.stack}>{children}</div>
    </div>
  );
}

export function SpecimenRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

/** Reuses the app's own Section shell. `id` anchors the index. */
export function GallerySection(
  { id, icon, title, description, children }: {
    id: string;
    icon: ReactNode;
    title: string;
    description: string;
    children: ReactNode;
  },
) {
  return (
    <div id={id}>
      <Section icon={icon} title={title} description={description}>
        {children}
      </Section>
    </div>
  );
}

/** Uncarded — for sections whose specimens are themselves Cards. */
export function BareSection(
  { id, icon, title, description, children }: {
    id: string;
    icon: ReactNode;
    title: string;
    description: string;
    children: ReactNode;
  },
) {
  return (
    <div id={id} className={styles.bareSection}>
      <div className={styles.bareHeader}>
        <span className={styles.bareIcon}>{icon}</span>
        <Text size="3" weight="bold">{title}</Text>
      </div>
      <Text size="2" color="gray">{description}</Text>
      {children}
    </div>
  );
}

export function Rule({ children }: { children: ReactNode }) {
  return (
    <Text size="1" color="gray" style={{ display: "block" }}>
      {children}
    </Text>
  );
}
