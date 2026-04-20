import { assertExists } from "@std/assert";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    log: {
      chargeController: {
        useQuery: (...args: [unknown, ...unknown[]]) => mocks.useQuery(...args),
      },
    },
  },
  RouterOutputs: {},
}));

import { useControllerLogs } from "./useControllerLogs.ts";

describe("useControllerLogs", () => {
  const fakeLog = {
    id: 1,
    timestamp: "2026-03-01T12:00:00Z",
    vehicleId: "VIN123",
    vehicleName: "Model 3",
    mode: "scheduled",
    inputs: {
      energy: {
        solarProductionW: 3000,
        gridPowerW: -500,
        homeConsumptionW: 2500,
        batterySoc: null,
      },
      vehicleState: {
        isPluggedIn: true,
        isCharging: true,
        batteryLevel: 60,
        chargeLimit: 80,
        chargeAmps: 16,
        chargeAmpsMin: 5,
        chargeAmpsMax: 32,
        chargePowerKw: 3.7,
      },
      config: {},
      activeSchedules: [],
    },
    checks: [{ check: "isPluggedIn", result: "true" }],
    action: "continue",
    actionDetail: "Vehicle charging normally",
    targetAmps: 16,
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

  type SetupOpts = {
    data?: unknown;
    isLoading?: boolean;
    error?: { message: string } | null;
  };

  let mockRefetch: ReturnType<typeof vi.fn>;

  const setQuery = (
    { data, isLoading = false, error = null }: SetupOpts = {},
  ) => {
    mocks.useQuery.mockReturnValue({
      data,
      isLoading,
      error,
      refetch: mockRefetch,
    });
  };

  const lastInput = () => {
    const lastCall = mocks.useQuery.mock.calls.at(-1);
    assertExists(lastCall);
    return lastCall[0] as Record<string, unknown>;
  };

  beforeEach(() => {
    mockRefetch = vi.fn();
    vi.clearAllMocks();
    // Default: loading state
    setQuery({ data: undefined, isLoading: true });
  });

  it("starts with loading=true and empty logs (pageSize 50)", () => {
    const { result } = renderHook(() => useControllerLogs(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.logs).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.pageSize).toBe(50);
  });

  it("loads logs on mount", () => {
    setQuery({ data: { logs: [fakeLog], total: 1 } });

    const { result } = renderHook(() => useControllerLogs(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.logs).toEqual([fakeLog]);
    expect(result.current.total).toBe(1);
    expect(result.current.error).toBeNull();

    expect(lastInput()).toEqual({
      vehicleId: undefined,
      limit: 50,
      offset: 0,
      from: undefined,
      to: undefined,
      action: undefined,
    });
  });

  it("pagination: setPage triggers reload with new offset", async () => {
    setQuery({ data: { logs: [fakeLog], total: 100 } });

    const { result } = renderHook(() => useControllerLogs(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setPage(1);
    });

    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });

    expect(lastInput().offset).toBe(50);
  });

  it("refresh triggers refetch", () => {
    setQuery({ data: { logs: [fakeLog], total: 1 } });

    const { result } = renderHook(() => useControllerLogs(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.refresh();
    });

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("error state on fetch failure", () => {
    setQuery({ data: undefined, error: { message: "Server error" } });

    const { result } = renderHook(() => useControllerLogs(), {
      wrapper: createWrapper(),
    });

    expect(result.current.error).toBe("Server error");
    expect(result.current.logs).toEqual([]);
  });

  it("passes from/to params in input when provided", () => {
    setQuery({ data: { logs: [fakeLog], total: 1 } });

    const fromDate = "2026-03-01T00:00:00.000Z";
    const toDate = "2026-03-01T23:59:59.999Z";

    renderHook(
      () => useControllerLogs(undefined, { from: fromDate, to: toDate }),
      { wrapper: createWrapper() },
    );

    expect(lastInput().from).toBe(fromDate);
    expect(lastInput().to).toBe(toDate);
  });

  it("passes action param in input when actions are filtered", () => {
    setQuery({ data: { logs: [fakeLog], total: 1 } });

    renderHook(
      () => useControllerLogs(undefined, { action: ["start", "stop"] }),
      { wrapper: createWrapper() },
    );

    expect(lastInput().action).toEqual(["start", "stop"]);
  });

  it.each([
    {
      name: "from/to",
      initial: { from: undefined as string | undefined, to: undefined } as
        | Record<string, unknown>
        | undefined,
      next: { from: "2026-03-01T00:00:00.000Z", to: undefined },
    },
    {
      name: "action",
      initial: { action: undefined as string[] | undefined },
      next: { action: ["start", "stop"] },
    },
  ])("changing $name resets page to 0", async ({ initial, next }) => {
    setQuery({ data: { logs: [fakeLog], total: 100 } });

    const { result, rerender } = renderHook(
      (props: Record<string, unknown>) => useControllerLogs(undefined, props),
      {
        initialProps: initial as Record<string, unknown>,
        wrapper: createWrapper(),
      },
    );

    act(() => {
      result.current.setPage(1);
    });

    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });

    rerender(next as Record<string, unknown>);

    await waitFor(() => {
      expect(result.current.page).toBe(0);
    });
  });
});
