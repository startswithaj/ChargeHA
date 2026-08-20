import styles from "./Spinner.module.css";

interface SpinnerProps {
  className?: string;
}

/** A command is running and we expect it back. For a wait we do not control,
 *  use WaitingBars. */
export function Spinner({ className }: SpinnerProps) {
  return (
    <span className={[styles.spinner, className].filter(Boolean).join(" ")} />
  );
}
