// Maps the dateless demo series onto real calendar dates relative to the
// viewer's "today", in their local timezone. Offset 0 is always today, so a
// build from months ago still shows "the last 90 days ending today".

const DAY_MS = 86_400_000;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local midnight of the viewer's today. */
export const startOfToday = (now: Date = new Date()): Date =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** "YYYY-MM-DD" for a local date. */
export const toDateKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Parse "YYYY-MM-DD" as a local date at midnight. */
export const parseDateKey = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** "YYYY-MM-DD" for the day `offset` days before today. */
export const dateForOffset = (offset: number, now?: Date): string =>
  toDateKey(new Date(startOfToday(now).getTime() - offset * DAY_MS));

/** Whole days between a date key and today (today = 0, yesterday = 1, …). */
export const offsetForDate = (key: string, now?: Date): number =>
  Math.round(
    (startOfToday(now).getTime() - parseDateKey(key).getTime()) / DAY_MS,
  );

/** Minutes since local midnight for a "HH:MM" time-of-day. */
export const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
