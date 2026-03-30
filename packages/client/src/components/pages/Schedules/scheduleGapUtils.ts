import type { Schedule, ScheduleType } from "@chargeha/shared";

// ---- Gap-finding helpers ----

/** 96 quarter-hour slots per day (00:00 = slot 0, 23:45 = slot 95) */
export const SLOTS = 96;
export const MAX_GAP_SLOTS = 24; // 6 hours cap

export function timeToSlot(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 4 + Math.floor(m / 15);
}

export function slotToTime(slot: number): string {
  const s = ((slot % SLOTS) + SLOTS) % SLOTS;
  const h = Math.floor(s / 4);
  const m = (s % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Find the largest free time window among existing schedules of the same type/vehicle.
 * Returns suggested start/end times for a new schedule, capped at 6 hours.
 */
export function findNextGap(
  schedules: Schedule[],
  scheduleType: ScheduleType,
  vehicleId: string | null,
): { startTime: string; endTime: string } {
  const relevant = schedules.filter((s) => {
    if (scheduleType === "charge") {
      return s.scheduleType === "charge" && s.vehicleId === vehicleId;
    }
    return s.scheduleType === "blockout";
  });

  if (relevant.length === 0) {
    return scheduleType === "blockout"
      ? { startTime: "16:00", endTime: "22:00" }
      : { startTime: "00:00", endTime: "06:00" };
  }

  // Build bitmap of occupied slots
  const occupied = new Array<boolean>(SLOTS).fill(false);
  // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
  for (const s of relevant) {
    const startSlot = timeToSlot(s.startTime);
    const endSlot = timeToSlot(s.endTime);

    if (endSlot > startSlot) {
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for (let i = startSlot; i < endSlot; i++) occupied[i] = true;
    } else {
      // Overnight range (e.g. 22:00–06:00)
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for (let i = startSlot; i < SLOTS; i++) occupied[i] = true;
      // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
      for (let i = 0; i < endSlot; i++) occupied[i] = true;
    }
  }

  // Collect contiguous free runs
  const runs: { start: number; length: number }[] = [];
  // tracking contiguous run start across iterations
  // deno-lint-ignore custom-no-let/no-let
  let runStart = -1;
  // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
  for (let i = 0; i < SLOTS; i++) {
    if (!occupied[i]) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        runs.push({ start: runStart, length: i - runStart });
        runStart = -1;
      }
    }
  }
  if (runStart !== -1) {
    runs.push({ start: runStart, length: SLOTS - runStart });
  }

  // Merge wrap-around gap (free slots at end + start of day)
  if (
    runs.length >= 2 &&
    runs[0].start === 0 &&
    runs[runs.length - 1].start + runs[runs.length - 1].length === SLOTS
  ) {
    const last = runs.pop();
    if (!last) throw new Error("Expected a run after length check");
    runs[0] = { start: last.start, length: last.length + runs[0].length };
  }

  if (runs.length === 0) {
    // Fully occupied — fall back to defaults
    return { startTime: "00:00", endTime: "06:00" };
  }

  // Pick the largest gap
  const best = runs.reduce((a, b) => (b.length > a.length ? b : a));
  const cappedLength = Math.min(best.length, MAX_GAP_SLOTS);

  return {
    startTime: slotToTime(best.start),
    endTime: slotToTime(best.start + cappedLength),
  };
}
