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
      pluginLogs: {
        useQuery: (_input: unknown, _opts?: unknown) => hoisted.queryReturn,
      },
    },
  },
}));

import { usePluginLogs } from "./usePluginLogs.ts";

describe("usePluginLogs", () => {
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
    const { result } = renderHook(() => usePluginLogs(), {
      wrapper: createWrapper(),
    });

    expect(result.current.logs).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.page).toBe(0);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.autoRefresh).toBe(true);
  });

  it("returns data when query has results", () => {
    const logs = [{ id: 1, level: "info", message: "Plugin started" }];
    setQuery({ data: { logs, total: 5 } });

    const { result } = renderHook(() => usePluginLogs(), {
      wrapper: createWrapper(),
    });

    expect(result.current.logs).toBe(logs);
    expect(result.current.total).toBe(5);
  });

  it("returns loading state", () => {
    setQuery({ isLoading: true });

    const { result } = renderHook(() => usePluginLogs(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);
  });

  it("returns error message", () => {
    setQuery({ error: { message: "Query failed" } });

    const { result } = renderHook(() => usePluginLogs(), {
      wrapper: createWrapper(),
    });

    expect(result.current.error).toBe("Query failed");
  });

  it("uses custom pageSize", () => {
    const { result } = renderHook(
      () => usePluginLogs(undefined, 10),
      { wrapper: createWrapper() },
    );

    expect(result.current.pageSize).toBe(10);
  });

  it("setPage updates the page", () => {
    const { result } = renderHook(() => usePluginLogs(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setPage(1);
    });

    expect(result.current.page).toBe(1);
  });

  it("setAutoRefresh toggles auto-refresh", () => {
    const { result } = renderHook(() => usePluginLogs(), {
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

    const { result } = renderHook(() => usePluginLogs(), {
      wrapper: createWrapper(),
    });

    result.current.refresh();
    expect(refetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    {
      key: "from" as const,
      a: { from: "2026-01-01" },
      b: { from: "2026-02-01" },
    },
    {
      key: "level" as const,
      a: { level: ["info"] },
      b: { level: ["error", "warn"] },
    },
  ])("resets page to 0 when $key filter changes", ({ a, b }) => {
    type Filter = { from?: string; to?: string; level?: string[] };
    const { result, rerender } = renderHook(
      ({ filter }: { filter?: Filter }) => usePluginLogs(filter),
      {
        wrapper: createWrapper(),
        initialProps: { filter: a as Filter },
      },
    );

    act(() => {
      result.current.setPage(3);
    });
    expect(result.current.page).toBe(3);

    rerender({ filter: b as Filter });
    expect(result.current.page).toBe(0);
  });
});
