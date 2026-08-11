export function kwValue(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return `${(watts / 1000).toFixed(1)} kW`;
  }
  return `${Math.round(watts)} W`;
}

export function kwhValue(wh: number): string {
  if (Math.abs(wh) >= 1000) {
    return `${(wh / 1000).toFixed(1)} kWh`;
  }
  return `${Math.round(wh)} Wh`;
}

// A charger with no current measurand derives amps from power ÷ voltage ÷
// phases, so decimals are a division artefact, not a real reading — nothing
// is commanded in fractional amps.
export function ampsValue(amps: number): string {
  return `${Math.round(amps)}A`;
}

export function ampsRange(amps: number, maxAmps: number): string {
  return `${ampsValue(amps)} / ${ampsValue(maxAmps)} max`;
}

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

export function formatCost(cents: number, currencySymbol: string): string {
  const dollars = cents / 100;
  return `${currencySymbol}${dollars.toFixed(2)}`;
}

// Uses 2 decimal places when sufficient, 4 when sub-cent precision exists.
export function formatRate(
  ratePerKwh: number,
  currencySymbol: string,
): string {
  const twoDecimal = Math.round(ratePerKwh * 100) / 100;
  if (ratePerKwh === twoDecimal) {
    return `${currencySymbol}${ratePerKwh.toFixed(2)}`;
  }
  return `${currencySymbol}${ratePerKwh.toFixed(4)}`;
}

export function formatRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
