import styles from "./WizardShell.module.css";

interface StepIndicatorProps {
  total: number;
  current: number;
  labels: string[];
}

/** Row of dots showing wizard progress. */
export function StepIndicator({ total, current, labels }: StepIndicatorProps) {
  return (
    <div
      className={styles.stepIndicator}
      role="navigation"
      aria-label="Wizard steps"
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`${styles.stepDot} ${
            i === current ? styles.stepDotActive : ""
          } ${i < current ? styles.stepDotCompleted : ""}`}
          title={labels[i]}
          aria-label={`Step ${i + 1}: ${labels[i]}`}
          aria-current={i === current ? "step" : undefined}
        />
      ))}
    </div>
  );
}
