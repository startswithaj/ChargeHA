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
      vehicleUpdates: {
        useQuery: (_input: unknown, _opts?: unknown) => hoisted.queryReturn,
      },
    },
  },
}));

import { useVehicleUpdates } from "./useVehicleUpdates.ts";

describe("useVehicleUpdates", () => {
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
    const { result } = renderHook(() => useVehicleUpdates(), {
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
    const readings = [{ id: 1, vin: "VIN1", timestamp: "2026-01-01" }];
    setQuery({ data: { readings, total: 42 } });

    const { result } = renderHook(() => useVehicleUpdates(), {
      wrapper: createWrapper(),
    });

    expect(result.current.readings).toBe(readings);
    expect(result.current.total).toBe(42);
  });

  it("returns loading state", () => {
    setQuery({ isLoading: true });

    const { result } = renderHook(() => useVehicleUpdates(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);
  });

  it("returns error message", () => {
    setQuery({ error: { message: "Network error" } });

    const { result } = renderHook(() => useVehicleUpdates(), {
      wrapper: createWrapper(),
    });

    expect(result.current.error).toBe("Network error");
  });

  it("uses custom pageSize", () => {
    const { result } = renderHook(
      () => useVehicleUpdates(undefined, undefined, 25),
      { wrapper: createWrapper() },
    );

    expect(result.current.pageSize).toBe(25);
  });

  it("setPage updates the page", () => {
    const { result } = renderHook(() => useVehicleUpdates(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setPage(3);
    });

    expect(result.current.page).toBe(3);
  });

  it("setAutoRefresh toggles auto-refresh", () => {
    const { result } = renderHook(() => useVehicleUpdates(), {
      wrapper: createWrapper(),
    });

    expect(result.current.autoRefresh).toBe(true);

    act(() => {
      result.current.setAutoRefresh(false);
    });

    expect(result.current.autoRefresh).toBe(false);
  });

  it("refresh calls refetch", () => {
    const refetchFn = vi.fn();
    setQuery({ refetch: refetchFn });

    const { result } = renderHook(() => useVehicleUpdates(), {
      wrapper: createWrapper(),
    });

    result.current.refresh();
    expect(refetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    {
      key: "vehicleId" as const,
      run: (props: { vehicleId?: string; filter?: unknown }) =>
        useVehicleUpdates(props.vehicleId),
      a: { vehicleId: "VIN1" },
      b: { vehicleId: "VIN2" },
    },
    {
      key: "filter" as const,
      run: (props: { vehicleId?: string; filter?: unknown }) =>
        useVehicleUpdates(
          undefined,
          props.filter as { from?: string; to?: string } | undefined,
        ),
      a: { filter: { from: "2026-01-01" } },
      b: { filter: { from: "2026-02-01" } },
    },
  ])("resets page to 0 when $key changes", ({ run, a, b }) => {
    type Props = { vehicleId?: string; filter?: unknown };
    const { result, rerender } = renderHook(
      (props: Props) => run(props),
      {
        wrapper: createWrapper(),
        initialProps: a as Props,
      },
    );

    act(() => {
      result.current.setPage(5);
    });
    expect(result.current.page).toBe(5);

    rerender(b as Props);
    expect(result.current.page).toBe(0);
  });
});
