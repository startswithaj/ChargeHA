/** What the home battery is doing, as far as the dashboard can tell. */
export interface HomeBatteryState {
  /** Current state of charge (%), or null when no battery is reporting. */
  socPct: number | null;
  /** The SoC the battery must reach before EV charging resumes. */
  targetPct: number;
  /** Rated capacity (kWh), or null when the inverter doesn't report it. */
  capacityKwh: number | null;
  /** Battery power (W) — positive is discharge, negative is charge. */
  powerW: number | null;
}

/**
 * Minutes for the home battery to reach `targetPct` at its current charge rate,
 * or null when no honest estimate is possible.
 *
 * Null covers every case where the answer would be a guess dressed as a fact:
 * no capacity from the inverter, no SoC, no power reading, the battery already
 * at or past the target, or a battery that is idle or discharging and so is
 * never going to arrive at the current rate.
 */
export function homeBatteryMinutesToTarget(
  battery: HomeBatteryState,
): number | null {
  const { socPct, targetPct, capacityKwh, powerW } = battery;
  if (socPct === null || capacityKwh === null || powerW === null) return null;
  if (capacityKwh <= 0 || socPct >= targetPct) return null;

  // Negative power is charging; idle or discharging has no arrival time.
  const chargeKw = -powerW / 1000;
  if (chargeKw <= 0) return null;

  const kwhToTarget = ((targetPct - socPct) / 100) * capacityKwh;
  return (kwhToTarget / chargeKw) * 60;
}
