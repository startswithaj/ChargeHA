import { useCallback, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import type { StatsPeriod } from "@chargeha/shared";
import { trpc } from "../trpc.ts";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatCursorLabel(period: StatsPeriod, cursor: Date): string {
  switch (period) {
    case "day": {
      const options: Intl.DateTimeFormatOptions = {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      };
      return cursor.toLocaleDateString("en-US", options);
    }
    case "month":
      return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
    case "year":
      return String(cursor.getFullYear());
  }
}

function isSamePeriod(period: StatsPeriod, a: Date, b: Date): boolean {
  switch (period) {
    case "day":
      return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
      );
    case "month":
      return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth()
      );
    case "year":
      return a.getFullYear() === b.getFullYear();
  }
}

function shiftCursor(
  period: StatsPeriod,
  cursor: Date,
  direction: -1 | 1,
): Date {
  const d = new Date(cursor);
  switch (period) {
    case "day":
      d.setDate(d.getDate() + direction);
      break;
    case "month":
      d.setDate(1); // Prevent day-of-month overflow (e.g. Mar 31 → Feb 31 → Mar 3)
      d.setMonth(d.getMonth() + direction);
      break;
    case "year":
      d.setFullYear(d.getFullYear() + direction);
      break;
  }
  return d;
}

function cursorToDateStr(cursor: Date): string {
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}-${
    String(cursor.getDate()).padStart(2, "0")
  }`;
}

export type DayResolution = "15m" | "1h";

export function useStats() {
  const [period, setPeriod] = useState<StatsPeriod>("day");
  const [resolution, setResolution] = useState<DayResolution>("1h");
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const tz = useMemo(() => -(new Date().getTimezoneOffset() / 60), []);

  const dayQuery = trpc.stats.day.useQuery(
    {
      date: cursorToDateStr(cursor),
      tz,
      resolution: resolution === "15m" ? "15m" : undefined,
    },
    { enabled: period === "day", placeholderData: keepPreviousData },
  );

  const monthQuery = trpc.stats.month.useQuery(
    { year: cursor.getFullYear(), month: cursor.getMonth() + 1, tz },
    { enabled: period === "month", placeholderData: keepPreviousData },
  );

  const yearQuery = trpc.stats.year.useQuery(
    { year: cursor.getFullYear(), tz },
    { enabled: period === "year", placeholderData: keepPreviousData },
  );

  const queries = { day: dayQuery, month: monthQuery, year: yearQuery };
  const activeQuery = queries[period];

  const { data, isLoading, error } = activeQuery;

  const isAtPresent = useMemo(
    () => isSamePeriod(period, cursor, new Date()),
    [period, cursor],
  );

  const cursorLabel = useMemo(
    () => formatCursorLabel(period, cursor),
    [period, cursor],
  );

  const goBack = useCallback(() => {
    setCursor((c) => shiftCursor(period, c, -1));
  }, [period]);

  const goForward = useCallback(() => {
    if (!isAtPresent) {
      setCursor((c) => shiftCursor(period, c, 1));
    }
  }, [period, isAtPresent]);

  const goToToday = useCallback(() => {
    setCursor(new Date());
  }, []);

  // Reset cursor to today when period changes
  const changePeriod = useCallback((p: StatsPeriod) => {
    setPeriod(p);
    setCursor(new Date());
  }, []);

  // Drill into a specific date/month from a chart click
  const drillDown = useCallback((p: StatsPeriod, date: Date) => {
    setPeriod(p);
    setCursor(date);
  }, []);

  return {
    period,
    setPeriod: changePeriod,
    resolution,
    setResolution,
    cursor,
    cursorLabel,
    isAtPresent,
    data: data ?? null,
    loading: isLoading,
    error: error?.message ?? null,
    goBack,
    goForward,
    goToToday,
    drillDown,
  };
}
