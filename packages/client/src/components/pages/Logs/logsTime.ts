import { localDateStr, offsetHoursAt } from "@chargeha/shared/timezone";
import type { TimeRangePreset } from "./Logs.tsx";

export function formatTimestamp(ts: string, timezone: string): string {
  return new Date(ts + "Z").toLocaleString(undefined, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function midnightUtc(dateStr: string, timezone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(
    Date.UTC(y, m - 1, d) - offsetHoursAt(timezone, dateStr) * 3_600_000,
  );
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function getPresetRange(
  preset: TimeRangePreset,
  now: Date,
  timezone: string,
): { from?: string; to?: string } {
  const hoursAgo = (h: number) => ({
    from: new Date(now.getTime() - h * 60 * 60 * 1000).toISOString(),
  });
  const today = localDateStr(now, timezone);

  switch (preset) {
    case "all":
      return {};
    case "1h":
      return hoursAgo(1);
    case "6h":
      return hoursAgo(6);
    case "24h":
      return hoursAgo(24);
    case "today":
      return { from: midnightUtc(today, timezone).toISOString() };
    case "yesterday": {
      const start = midnightUtc(shiftDate(today, -1), timezone);
      const end = new Date(midnightUtc(today, timezone).getTime() - 1);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    case "7d":
      return hoursAgo(7 * 24);
    case "custom":
      return {};
  }
}
