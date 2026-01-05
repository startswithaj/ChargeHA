import { sql } from "drizzle-orm";

/**
 * Build a safe SQLite datetime modifier string for timezone offsets.
 * Validates the input is a finite number to prevent injection via sql.raw().
 */
export function sqliteTimezoneOffset(tzOffsetHours: number) {
  if (!Number.isFinite(tzOffsetHours)) {
    throw new Error(`Invalid timezone offset: ${tzOffsetHours}`);
  }
  const sign = tzOffsetHours >= 0 ? "+" : "";
  return sql.raw(`'${sign}${tzOffsetHours} hours'`);
}

/**
 * Normalize an ISO/parseable datetime string into SQLite's stored format
 * (`YYYY-MM-DD HH:MM:SS` in UTC).
 *
 * Timestamp columns are written via `datetime('now')`, which produces a
 * space-separated UTC string with no timezone suffix. Comparing those values
 * against ISO strings like `2026-04-07T15:37:00.000Z` via drizzle's `gte`/`lte`
 * uses SQLite text collation, where ' ' (0x20) < 'T' (0x54). That makes
 * same-day bounds silently wrong (rows later in the day can compare as "less
 * than" a bound earlier in the day). Normalizing the bound to the same
 * format the column uses restores correct ordering.
 */
export function toSqliteDatetime(input: string): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid datetime: ${input}`);
  }
  return d.toISOString().slice(0, 19).replace("T", " ");
}
