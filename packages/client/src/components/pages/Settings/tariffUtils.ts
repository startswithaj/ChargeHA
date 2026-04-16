import type { DayOfWeek } from "@chargeha/shared";

export const ALL_DAYS: DayOfWeek[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];
export const WEEKDAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri"];
export const WEEKEND: DayOfWeek[] = ["sat", "sun"];

export const DAY_LABELS: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export interface PeriodFormData {
  label: string;
  startTime: string;
  endTime: string;
  days: string[];
  ratePerKwh: string;
}

export const EMPTY_FORM: PeriodFormData = {
  label: "",
  startTime: "00:00",
  endTime: "23:45",
  days: [...ALL_DAYS],
  ratePerKwh: "",
};

export interface OverlapError {
  periodA: string;
  periodB: string;
  days: string[];
}

export interface GapWarning {
  days: string[];
  startTime: string;
  endTime: string;
}

export function formatDays(days: string[]): string {
  if (days.length === 7) return "Every day";
  const sorted = ALL_DAYS.filter((d) => days.includes(d));
  if (
    sorted.length === 5 &&
    WEEKDAYS.every((d) => sorted.includes(d))
  ) {
    return "Weekdays";
  }
  if (
    sorted.length === 2 &&
    WEEKEND.every((d) => sorted.includes(d))
  ) {
    return "Weekends";
  }
  return sorted.map((d) => DAY_LABELS[d]).join(", ");
}

/** Convert "HH:MM" to minutes since midnight */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Convert minutes since midnight to "HH:MM" */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ── Time range helpers ──────────────────────────────────────────────────────

const MINUTES_PER_DAY = 1440;

interface TimeRange {
  start: number;
  end: number;
}

/** Expand an overnight range (start >= end) into two day-bounded ranges. */
function expandOvernight(range: TimeRange): TimeRange[] {
  if (range.start >= range.end) {
    return [
      { start: range.start, end: MINUTES_PER_DAY },
      { start: 0, end: range.end },
    ];
  }
  return [range];
}

/** Merge overlapping/adjacent time ranges into non-overlapping ranges. */
function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  return sorted.reduce<TimeRange[]>((merged, range) => {
    const prev = merged.at(-1);
    if (prev && range.start <= prev.end) {
      return [...merged.slice(0, -1), {
        start: prev.start,
        end: Math.max(prev.end, range.end),
      }];
    }
    return [...merged, range];
  }, []);
}

/** Find gaps (uncovered intervals) within a full day given covered ranges. */
function findGaps(covered: TimeRange[]): TimeRange[] {
  const merged = mergeRanges(covered);
  if (merged.length === 0) return [{ start: 0, end: MINUTES_PER_DAY }];

  // Build all potential gaps: before first, between each pair, after last
  const edges = [
    { start: 0, end: merged[0].start },
    ...merged.slice(1).map((range, i) => ({
      start: merged[i].end,
      end: range.start,
    })),
    { start: merged[merged.length - 1].end, end: MINUTES_PER_DAY },
  ];
  return edges.filter((r) => r.start < r.end);
}

/** Convert a period's times into day-bounded TimeRanges (handling overnight wrap). */
function periodToRanges(startTime: string, endTime: string): TimeRange[] {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return expandOvernight({ start, end });
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Check if two time ranges overlap, accounting for overnight wrapping */
export function timeRangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  const a = expandOvernight({ start: startA, end: endA });
  const b = expandOvernight({ start: startB, end: endB });
  return a.some((ra) => b.some((rb) => ra.start < rb.end && rb.start < ra.end));
}

/** Detect overlaps between a list of periods (label, startTime, endTime, days) */
export function detectOverlaps(
  periods: {
    label: string;
    startTime: string;
    endTime: string;
    days: string[];
  }[],
): OverlapError[] {
  return periods.flatMap((a, i) =>
    periods.slice(i + 1).flatMap((b) => {
      const commonDays = a.days.filter((d) => b.days.includes(d));
      if (commonDays.length === 0) return [];
      if (
        !timeRangesOverlap(
          timeToMinutes(a.startTime),
          timeToMinutes(a.endTime),
          timeToMinutes(b.startTime),
          timeToMinutes(b.endTime),
        )
      ) return [];
      return [{
        periodA: a.label || "(unnamed)",
        periodB: b.label || "(unnamed)",
        days: commonDays,
      }];
    })
  );
}

export function formatOverlapMessage(overlap: OverlapError): string {
  const dayStr = formatDays(overlap.days);
  return `${overlap.periodA} and ${overlap.periodB} overlap on ${dayStr}`;
}

/** Find uncovered time gaps for a specific day given a set of periods */
export function findGapsForDay(
  periods: { startTime: string; endTime: string; days: string[] }[],
  day: string,
): [number, number][] {
  const covered = periods
    .filter((p) => p.days.includes(day))
    .flatMap((p) => periodToRanges(p.startTime, p.endTime));

  return findGaps(covered).map((r) => [r.start, r.end]);
}

/** Detect time gaps across all days, grouping consecutive days with the same pattern */
export function detectGaps(
  periods: { startTime: string; endTime: string; days: string[] }[],
): GapWarning[] {
  // For each day, compute gap ranges and group days with identical patterns
  const dayGapEntries = ALL_DAYS
    .map((day) => ({ day, gaps: findGapsForDay(periods, day) }))
    .filter(({ gaps }) => gaps.length > 0);

  const grouped = dayGapEntries.reduce((map, entry) => {
    const key = JSON.stringify(entry.gaps);
    const group = map.get(key) ?? [];
    group.push(entry);
    map.set(key, group);
    return map;
  }, new Map<string, typeof dayGapEntries>());

  return [...grouped.values()].flatMap((entries) => {
    const days = entries.map((e) => e.day);
    return entries[0].gaps.map(([start, end]) => ({
      days,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
    }));
  });
}

/** Convert gap warnings into pre-filled form data for a new period */
export function gapToFormData(gaps: GapWarning[]): PeriodFormData {
  if (gaps.length === 0) return { ...EMPTY_FORM };

  // Try to merge overnight gaps: one ending at "24:00" + one starting at "00:00" on same days
  const endsAtMidnight = gaps.find((g) => g.endTime === "24:00");
  const startsAtMidnight = gaps.find((g) => g.startTime === "00:00");

  if (
    endsAtMidnight && startsAtMidnight && endsAtMidnight !== startsAtMidnight &&
    endsAtMidnight.days.length === startsAtMidnight.days.length &&
    endsAtMidnight.days.every((d) => startsAtMidnight.days.includes(d))
  ) {
    return {
      ...EMPTY_FORM,
      startTime: endsAtMidnight.startTime,
      endTime: startsAtMidnight.endTime,
      days: [...endsAtMidnight.days],
    };
  }

  const gap = endsAtMidnight ?? gaps[0];

  return {
    ...EMPTY_FORM,
    startTime: gap.startTime,
    // "24:00" → "00:00" to create an overnight period that wraps
    endTime: gap.endTime === "24:00" ? "00:00" : gap.endTime,
    days: [...gap.days],
  };
}

export function formatGapMessage(warning: GapWarning): string {
  const dayStr = formatDays(warning.days);
  return `No tariff rate defined for ${dayStr} ${warning.startTime}\u2013${warning.endTime} (default rate will apply)`;
}
