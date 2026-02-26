import styles from "./Spinner.module.css";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  const classes = [styles.spinner, size !== "md" && styles[size], className]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} />;
}
