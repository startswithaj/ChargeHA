/** For a wait with no measurable pace — says "still going" without implying
 *  progress toward a deadline. Where a real number exists, show that instead.
 *  Exposed to plugins through `hostUi.ts`. */
interface WaitingBarsProps {
  /** "lg" for a wait that owns the whole screen. */
  size?: "md" | "lg";
}

const BAR: Record<"md" | "lg", { width: number; height: number }> = {
  md: { width: 3, height: 14 },
  lg: { width: 5, height: 24 },
};

export function WaitingBars({ size = "md" }: WaitingBarsProps) {
  const { width, height } = BAR[size];
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: size === "lg" ? 5 : 3,
      }}
      role="status"
      aria-label="Waiting"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width,
            height,
            borderRadius: 2,
            background: "var(--blue-9)",
            animation: `waitBounce 1s ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </span>
  );
}
