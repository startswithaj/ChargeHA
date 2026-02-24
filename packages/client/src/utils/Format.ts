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
