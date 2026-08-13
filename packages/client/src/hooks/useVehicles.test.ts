import { assertExists } from "@std/assert";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

type QueryOpts = { select?: (data: unknown) => unknown };

const hoisted = vi.hoisted(() => ({
  capturedQueryOptions: { current: null as QueryOpts | null },
  invalidate: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    vehicle: {
      list: {
        useQuery: hoisted.useQuery.mockImplementation(
          (_input: unknown, opts: QueryOpts) => {
            hoisted.capturedQueryOptions.current = opts;
            return { data: undefined, isLoading: true, error: null };
          },
        ),
      },
    },
    useUtils: vi.fn(() => ({
      vehicle: {
        list: {
          invalidate: hoisted.invalidate,
        },
      },
    })),
  },
}));

vi.mock("./vehicleErrorStore.ts", () => ({
  useVehicleErrors: () => ({}),
}));

import { useVehicles } from "./useVehicles.ts";

describe("useVehicles", () => {
  const fakeVehicle = {
    id: "VIN123",
    name: "Model 3",
    adapterType: "tesla",
    priority: 1,
    config: "{}",
    mode: "scheduled",
    state: {
      vehicleId: "VIN123",
      isPluggedIn: true,
      isCharging: false,
      isOnline: true,
      batteryLevel: 60,
      chargeLimit: 80,
      chargeAmps: 16,
      chargeAmpsMin: 5,
      chargeAmpsMax: 32,
      chargePowerKw: 0,
      chargerVoltage: 240,
      chargerPhases: 1,
      energyAddedKwh: 0,
      minutesToFull: 0,
      chargePortOpen: true,
      vehicleName: "Model 3",
    },
  };

  type QueryResult = {
    data: unknown;
    isLoading: boolean;
    error: { message: string } | null;
  };

  const setQuery = (state: Partial<QueryResult>) => {
    hoisted.useQuery.mockReturnValue(
      {
        data: undefined,
        isLoading: false,
        error: null,
        ...state,
      } satisfies QueryResult,
    );
  };

  beforeEach(() => {
    hoisted.capturedQueryOptions.current = null;
    hoisted.invalidate.mockClear();
    hoisted.useQuery.mockReset();
    hoisted.useQuery.mockImplementation((_input: unknown, opts: QueryOpts) => {
      hoisted.capturedQueryOptions.current = opts;
      return { data: undefined, isLoading: true, error: null };
    });
  });

  it("starts with loading=true", () => {
    const { result } = renderHook(() => useVehicles());
    expect(result.current.loading).toBe(true);
  });

  it("returns vehicles from query via select transform", () => {
    renderHook(() => useVehicles());

    assertExists(hoisted.capturedQueryOptions.current);
    const select = hoisted.capturedQueryOptions.current.select;
    assertExists(select);
    const result = select({ vehicles: [fakeVehicle] });
    expect(result).toEqual([fakeVehicle]);
  });

  it("returns vehicles when data loaded", () => {
    setQuery({ data: [fakeVehicle] });

    const { result } = renderHook(() => useVehicles());

    expect(result.current.loading).toBe(false);
    expect(result.current.vehicles).toEqual([fakeVehicle]);
    expect(result.current.error).toBeNull();
  });

  it("returns error message on query error", () => {
    setQuery({ error: { message: "Network error" } });

    const { result } = renderHook(() => useVehicles());

    expect(result.current.error).toBe("Network error");
  });

  it("refreshVehicles calls invalidate", () => {
    const { result } = renderHook(() => useVehicles());
    result.current.refreshVehicles();

    expect(hoisted.invalidate).toHaveBeenCalledTimes(1);
  });
});
