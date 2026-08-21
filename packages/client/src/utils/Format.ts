/**
 * Format watts to a human-readable kW string.
 * e.g. 5234 → "5.2 kW", 342 → "342 W"
 */
export function kwValue(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return `${(watts / 1000).toFixed(1)} kW`;
  }
  return `${Math.round(watts)} W`;
}

/**
 * Format watt-hours to a human-readable kWh string.
 * e.g. 12345 → "12.3 kWh"
 */
export function kwhValue(wh: number): string {
  if (Math.abs(wh) >= 1000) {
    return `${(wh / 1000).toFixed(1)} kWh`;
  }
  return `${Math.round(wh)} Wh`;
}

/**
 * Format 24h time string (HH:MM) to 12h format.
 * e.g. "13:00" → "1:00 PM", "00:30" → "12:30 AM"
 */
function toHour12(h: number): number {
  if (h === 0) return 12;
  if (h > 12) return h - 12;
  return h;
}

export function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  return `${toHour12(h)}:${String(m).padStart(2, "0")} ${period}`;
}

const DAY_LABELS: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];
const WEEKENDS = ["sat", "sun"];

/**
 * Format an array of day codes to a human-readable string.
 * e.g. all 7 → "Every Day", mon-fri → "Weekdays", sat+sun → "Weekends"
 */
export function formatDays(days: string[]): string {
  const sorted = ALL_DAYS.filter((d) => days.includes(d));
  if (sorted.length === 7) return "Every Day";
  if (
    sorted.length === 5 &&
    WEEKDAYS.every((d) => sorted.includes(d))
  ) {
    return "Weekdays";
  }
  if (
    sorted.length === 2 &&
    WEEKENDS.every((d) => sorted.includes(d))
  ) {
    return "Weekends";
  }
  return sorted.map((d) => DAY_LABELS[d]).join(", ");
}

/**
 * Format a "YYYY-MM-DD" calendar date for display.
 * e.g. "2026-08-12" → "Wed 12 Aug"
 */
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // Built as UTC so the calendar date is never shifted by the host's offset
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * Format cents to a currency string.
 * e.g. formatCost(1250, '$') → '$12.50'
 */
export function formatCost(cents: number, currencySymbol: string): string {
  const dollars = cents / 100;
  return `${currencySymbol}${dollars.toFixed(2)}`;
}

/**
 * Format a rate (stored in currency unit per kWh) for display.
 * Uses 2 decimal places when sufficient, 4 when sub-cent precision exists.
 * e.g. formatRate(0.35, '$') → '$0.35', formatRate(0.3553, '$') → '$0.3553'
 */
export function formatRate(
  ratePerKwh: number,
  currencySymbol: string,
): string {
  // Use 2dp if that's enough precision, otherwise 4dp
  const twoDecimal = Math.round(ratePerKwh * 100) / 100;
  if (ratePerKwh === twoDecimal) {
    return `${currencySymbol}${ratePerKwh.toFixed(2)}`;
  }
  return `${currencySymbol}${ratePerKwh.toFixed(4)}`;
}

/**
 * Format a duration as a coarse, human-readable estimate.
 *
 * Deliberately low-resolution: the inputs are estimates derived from an
 * instantaneous power reading, so a to-the-minute figure would flicker on a
 * partly cloudy day and read like a countdown rather than a guess. Rounding
 * hard means the text only changes when the estimate really moves.
 *
 * Expects a finite, non-negative number of minutes — callers decide whether an
 * estimate is possible at all and pass nothing when it isn't.
 *
 * e.g. 3 → "under 5 minutes", 33 → "35 minutes", 100 → "1.5 hours"
 */
export function formatDurationCoarse(minutes: number): string {
  if (minutes < 5) return "under 5 minutes";
  if (minutes >= 600) return "over 10 hours";

  // Round to 5 minutes below the hour, half-hours above it. A value that rounds
  // up to a full 60 reads better as "1 hour" than "60 minutes".
  const roundedMinutes = Math.round(minutes / 5) * 5;
  if (roundedMinutes < 60) return `${roundedMinutes} minutes`;

  const hours = Math.round(minutes / 30) / 2;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/**
 * Format a date to a relative time string.
 * e.g. "just now", "5s ago", "2m ago"
 */
export function formatRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
