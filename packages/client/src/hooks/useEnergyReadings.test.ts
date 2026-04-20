import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

const hoisted = vi.hoisted(() => ({
  queryReturn: {} as Record<string, unknown>,
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    log: {
      energyReads: {
        useQuery: (_input: unknown, _opts?: unknown) => hoisted.queryReturn,
      },
    },
  },
}));

import { useEnergyReadings } from "./useEnergyReadings.ts";

describe("useEnergyReadings", () => {
  const createWrapper = () => {
    const qc = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
  };

  const setQuery = (over: Record<string, unknown> = {}) => {
    hoisted.queryReturn = {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      ...over,
    };
  };

  beforeEach(() => {
    setQuery();
  });

  it("returns default values when no data", () => {
    const { result } = renderHook(() => useEnergyReadings(), {
      wrapper: createWrapper(),
    });

    expect(result.current.readings).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.page).toBe(0);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.autoRefresh).toBe(true);
  });

  it("returns data when query has results", () => {
    const readings = [{ id: 1, timestamp: "2026-01-01", solarW: 5000 }];
    setQuery({ data: { readings, total: 100 } });

    const { result } = renderHook(() => useEnergyReadings(), {
      wrapper: createWrapper(),
    });

    expect(result.current.readings).toBe(readings);
    expect(result.current.total).toBe(100);
  });

  it("returns loading state", () => {
    setQuery({ isLoading: true });

    const { result } = renderHook(() => useEnergyReadings(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);
  });

  it("returns error message", () => {
    setQuery({ error: { message: "Server error" } });

    const { result } = renderHook(() => useEnergyReadings(), {
      wrapper: createWrapper(),
    });

    expect(result.current.error).toBe("Server error");
  });

  it("uses custom pageSize", () => {
    const { result } = renderHook(
      () => useEnergyReadings(undefined, 25),
      { wrapper: createWrapper() },
    );

    expect(result.current.pageSize).toBe(25);
  });

  it("setPage updates the page", () => {
    const { result } = renderHook(() => useEnergyReadings(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setPage(2);
    });

    expect(result.current.page).toBe(2);
  });

  it("setAutoRefresh toggles auto-refresh", () => {
    const { result } = renderHook(() => useEnergyReadings(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setAutoRefresh(false);
    });

    expect(result.current.autoRefresh).toBe(false);
  });

  it("refresh calls refetch", () => {
    const refetchFn = vi.fn();
    setQuery({ refetch: refetchFn });

    const { result } = renderHook(() => useEnergyReadings(), {
      wrapper: createWrapper(),
    });

    result.current.refresh();
    expect(refetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    { key: "from" as const, a: "2026-01-01", b: "2026-02-01" },
    { key: "to" as const, a: "2026-01-31", b: "2026-02-28" },
  ])("resets page to 0 when $key filter changes", ({ key, a, b }) => {
    const { result, rerender } = renderHook(
      ({ filter }: { filter?: { from?: string; to?: string } }) =>
        useEnergyReadings(filter),
      {
        wrapper: createWrapper(),
        initialProps: { filter: { [key]: a } },
      },
    );

    act(() => {
      result.current.setPage(4);
    });
    expect(result.current.page).toBe(4);

    rerender({ filter: { [key]: b } });
    expect(result.current.page).toBe(0);
  });
});
