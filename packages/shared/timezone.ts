function zonedParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const find = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing "${type}" in formatted date parts`);
    return Number(part.value);
  };

  return {
    year: find("year"),
    month: find("month"),
    day: find("day"),
    hour: find("hour") % 24,
    minute: find("minute"),
    second: find("second"),
  };
}

export function localDateStr(instant: Date, timezone: string): string {
  const { year, month, day } = zonedParts(instant, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}
