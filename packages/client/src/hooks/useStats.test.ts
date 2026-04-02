import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

type Period = "day" | "month" | "year";
type QueryState = {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
};

const hoisted = vi.hoisted(() => {
  const initial = (): QueryState => ({
    data: undefined,
    isLoading: true,
    error: null,
  });
  return {
    results: {
      day: initial(),
      month: initial(),
      year: initial(),
    } as Record<"day" | "month" | "year", QueryState>,
  };
});

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    stats: {
      day: {
        useQuery: vi.fn((_input: unknown, _opts: unknown) =>
          hoisted.results.day
        ),
      },
      month: {
        useQuery: vi.fn((_input: unknown, _opts: unknown) =>
          hoisted.results.month
        ),
      },
      year: {
        useQuery: vi.fn((_input: unknown, _opts: unknown) =>
          hoisted.results.year
        ),
      },
    },
  },
}));

import { useStats } from "./useStats.ts";

describe("useStats", () => {
  const fakeStatsResponse = {
    period: "day" as const,
    startDate: "2026-03-01",
    endDate: "2026-03-01",
    buckets: [],
    energyBuckets: [],
    solarProductionLine: [],
    totalChargedWh: 0,
    totalSolarWh: 0,
    totalGridWh: 0,
    totalAwayWh: 0,
    selfPoweredPercent: 0,
    homeSolarProductionWh: 0,
    homeConsumedWh: 0,
    homeSolarWh: 0,
    homeGridWh: 0,
    homeSelfPoweredPercent: 0,
  };

  const createWrapper = () => {
    const queryClient = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
  };

  const setResult = (period: Period, state: Partial<QueryState>) => {
    hoisted.results[period] = {
      data: undefined,
      isLoading: false,
      error: null,
      ...state,
    };
  };

  const setOk = (period: Period, data: unknown) => setResult(period, { data });

  const setError = (period: Period, message: string) =>
    setResult(period, { error: new Error(message) });

  const renderWithDay = () => {
    setOk("day", fakeStatsResponse);
    return renderHook(() => useStats(), { wrapper: createWrapper() });
  };

  const switchTo = (
    result: { current: ReturnType<typeof useStats> },
    period: Period,
    data: unknown = { ...fakeStatsResponse, period },
  ) => {
    setOk(period, data);
    act(() => {
      result.current.setPeriod(period);
    });
  };

  beforeEach(() => {
    setResult("day", { isLoading: true, data: undefined });
    setResult("month", { isLoading: true, data: undefined });
    setResult("year", { isLoading: true, data: undefined });
  });

  it("starts with period='day' and data=null", () => {
    const { result } = renderHook(() => useStats(), {
      wrapper: createWrapper(),
    });

    expect(result.current.period).toBe("day");
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches stats on mount for day period", () => {
    setOk("day", fakeStatsResponse);
    const { result } = renderHook(() => useStats(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(fakeStatsResponse);
  });

  it("setPeriod changes period and resets cursor", () => {
    const { result } = renderWithDay();
    switchTo(result, "month");

    expect(result.current.period).toBe("month");
  });

  it("goForward does nothing when at present", () => {
    const { result } = renderWithDay();

    expect(result.current.isAtPresent).toBe(true);

    const cursorBefore = new Date(result.current.cursor);

    act(() => {
      result.current.goForward();
    });

    expect(result.current.cursor.getDate()).toBe(cursorBefore.getDate());
  });

  it("goForward advances cursor when not at present", () => {
    const { result } = renderWithDay();

    act(() => {
      result.current.goBack();
    });
    expect(result.current.isAtPresent).toBe(false);

    const cursorAfterBack = new Date(result.current.cursor);

    act(() => {
      result.current.goForward();
    });

    const diffMs = result.current.cursor.getTime() - cursorAfterBack.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    expect(diffDays).toBeCloseTo(1, 0);
  });

  it("goToToday resets cursor", () => {
    const { result } = renderWithDay();

    act(() => {
      result.current.goBack();
    });
    expect(result.current.isAtPresent).toBe(false);

    act(() => {
      result.current.goToToday();
    });

    expect(result.current.isAtPresent).toBe(true);
  });

  it("resolution defaults to '1h'", () => {
    const { result } = renderHook(() => useStats(), {
      wrapper: createWrapper(),
    });

    expect(result.current.resolution).toBe("1h");
  });

  it("setResolution changes resolution", () => {
    const { result } = renderWithDay();

    act(() => {
      result.current.setResolution("15m");
    });

    expect(result.current.resolution).toBe("15m");
  });

  it.each<{ period: Period; pattern: RegExp }>([
    { period: "day", pattern: /\w+ \d{1,2}/ },
    { period: "month", pattern: /\w+ \d{4}/ },
    { period: "year", pattern: /^\d{4}$/ },
  ])("cursorLabel for $period matches pattern", ({ period, pattern }) => {
    const { result } = renderWithDay();
    if (period !== "day") switchTo(result, period);
    expect(result.current.cursorLabel).toMatch(pattern);
  });

  it.each<{
    period: Period;
    advance: (d: Date) => number;
    diff: number;
  }>([
    {
      period: "day",
      advance: (d) => d.getTime(),
      diff: 1,
    },
  ])(
    "goBack shifts cursor back one day (period $period)",
    ({ advance, diff }) => {
      const { result } = renderWithDay();

      const cursorBefore = new Date(result.current.cursor);

      act(() => {
        result.current.goBack();
      });

      const diffMs = advance(cursorBefore) - advance(result.current.cursor);
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeCloseTo(diff, 0);
    },
  );

  it("goBack shifts cursor back one month for month period", () => {
    const { result } = renderWithDay();
    switchTo(result, "month");

    const monthBefore = result.current.cursor.getMonth();

    act(() => {
      result.current.goBack();
    });

    const expectedMonth = monthBefore === 0 ? 11 : monthBefore - 1;
    expect(result.current.cursor.getMonth()).toBe(expectedMonth);
  });

  it("goBack shifts cursor back one year for year period", () => {
    const { result } = renderWithDay();
    switchTo(result, "year");

    const yearBefore = result.current.cursor.getFullYear();

    act(() => {
      result.current.goBack();
    });

    expect(result.current.cursor.getFullYear()).toBe(yearBefore - 1);
  });

  it.each<{ period: Period }>([
    { period: "day" },
    { period: "month" },
    { period: "year" },
  ])("isAtPresent is correct for $period period", ({ period }) => {
    const { result } = renderWithDay();
    if (period !== "day") switchTo(result, period);

    expect(result.current.isAtPresent).toBe(true);

    act(() => {
      result.current.goBack();
    });

    expect(result.current.isAtPresent).toBe(false);
  });

  it("fetches year stats when period is set to year", () => {
    const { result } = renderWithDay();
    const yearResponse = { ...fakeStatsResponse, period: "year" as const };
    switchTo(result, "year", yearResponse);

    expect(result.current.data).toEqual(yearResponse);
  });

  it.each<{ period: Period; message: string }>([
    { period: "day", message: "Network error" },
    { period: "month", message: "Month fetch failed" },
    { period: "year", message: "Year fetch failed" },
  ])(
    "fetch error for $period sets error state",
    ({ period, message }) => {
      if (period === "day") {
        setError("day", message);
        const { result } = renderHook(() => useStats(), {
          wrapper: createWrapper(),
        });
        expect(result.current.error).toBe(message);
        expect(result.current.data).toBeNull();
      } else {
        const { result } = renderWithDay();
        setError(period, message);
        act(() => {
          result.current.setPeriod(period);
        });
        expect(result.current.error).toBe(message);
      }
    },
  );
});
