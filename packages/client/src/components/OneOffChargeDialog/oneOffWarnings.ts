import type { Schedule, VehicleMode } from "@chargeha/shared";
import { formatDurationMinutes } from "@chargeha/shared/oneOffCharge";
import type { OneOffWindow } from "@chargeha/shared/oneOffCharge";
import { dayOfWeekForDate } from "@chargeha/shared/localTime";
import { timeRangesOverlap } from "../../hooks/useSchedules.ts";
import { formatTime12h } from "../../utils/Format.ts";

export interface OneOffWarning {
  id: "mode" | "blockout" | "overlap";
  text: string;
}

const MODE_LABELS: Record<VehicleMode, string> = {
  auto: "Auto",
  charge_now: "Charge Now",
  stop: "Stopped",
};

const range = (startTime: string, endTime: string) =>
  `${formatTime12h(startTime)}–${formatTime12h(endTime)}`;

const oneOffDateOf = (s: Schedule): string | null =>
  s.scheduleType === "charge" ? s.oneOffDate : null;

/** Schedules whose window overlaps the proposed one-off, on a day it runs. */
function findClashes(
  schedules: Schedule[],
  startTime: string,
  window: OneOffWindow,
  excludeId?: string,
): Schedule[] {
  // The dates the window touches — two when it wraps past midnight
  const dates = window.wrapsMidnight
    ? [window.oneOffDate, window.endDate]
    : [window.oneOffDate];
  const weekdays = dates.map(dayOfWeekForDate);

  return schedules.filter((s) => {
    if (!s.enabled || s.id === excludeId) return false;
    if (!timeRangesOverlap(startTime, window.endTime, s.startTime, s.endTime)) {
      return false;
    }
    // A one-off applies on its date; a recurring schedule on its weekdays.
    const otherDate = oneOffDateOf(s);
    return otherDate
      ? dates.includes(otherDate)
      : s.days.some((d) => weekdays.includes(d));
  });
}

/**
 * Warnings for a proposed one-off charge. All are advisory — the charge is
 * still created, because the user may be about to fix the cause (switching
 * mode, removing a blockout) or may simply not care.
 *
 * Each corresponds to a way the window can silently fail to charge:
 *  - mode: charge schedules are only evaluated in auto mode
 *  - blockout: blockouts are evaluated before charge schedules, so they win
 *  - overlap: schedules are matched in creation order, so an existing
 *    recurring charge schedule takes precedence and its amps apply instead
 */
export function getOneOffWarnings(
  { window, startTime, durationMinutes, mode, schedules, excludeId }: {
    window: OneOffWindow;
    startTime: string;
    durationMinutes: number;
    mode: VehicleMode;
    schedules: Schedule[];
    /** The pending one-off being replaced, excluded from overlap checks. */
    excludeId?: string;
  },
): OneOffWarning[] {
  const clashes = findClashes(schedules, startTime, window, excludeId);
  return [
    ...modeWarning(mode),
    ...blockoutWarning(clashes),
    ...overlapWarning(clashes, durationMinutes),
  ];
}

/** Charge schedules are only evaluated in auto mode. */
function modeWarning(mode: VehicleMode): OneOffWarning[] {
  if (mode === "auto") return [];
  return [{
    id: "mode",
    text: `This vehicle is in ${
      MODE_LABELS[mode]
    } mode. Scheduled charges only run in Auto.`,
  }];
}

/** Blockouts are evaluated before charge schedules, so they win outright. */
function blockoutWarning(clashes: Schedule[]): OneOffWarning[] {
  const blockout = clashes.find((s) => s.scheduleType === "blockout");
  if (!blockout) return [];
  return [{
    id: "blockout",
    text: `Overlaps a blockout (${
      range(blockout.startTime, blockout.endTime)
    }). Blockouts take priority, so this charge won't run during it.`,
  }];
}

/** Schedules are matched in creation order, so an existing recurring schedule
 *  is found first and its amps apply for the overlap. */
function overlapWarning(
  clashes: Schedule[],
  durationMinutes: number,
): OneOffWarning[] {
  const recurring = clashes.find((s) =>
    s.scheduleType === "charge" && !oneOffDateOf(s)
  );
  if (!recurring) return [];
  return [{
    id: "overlap",
    text: `Overlaps an existing charge schedule (${
      range(recurring.startTime, recurring.endTime)
    }), which takes precedence for the ${
      formatDurationMinutes(durationMinutes)
    } window.`,
  }];
}
