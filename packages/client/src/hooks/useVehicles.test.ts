import { assertExists } from "@std/assert";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

type QueryOpts = { select?: (data: unknown) => unknown };
type MutationOpts = {
  onMutate?: (args: { vehicleId: string }) => unknown;
  onSuccess?: (result: unknown, vars: unknown) => unknown;
  onError?: (err: { message: string }) => unknown;
  onSettled?: (...args: unknown[]) => unknown;
};

const hoisted = vi.hoisted(() => ({
  capturedQueryOptions: { current: null as QueryOpts | null },
  setData: vi.fn(),
  invalidate: vi.fn(),
  capturedMutationOptions: {} as Partial<
    Record<"start" | "stop" | "setAmps" | "setMode", MutationOpts>
  >,
  startMutateAsync: vi.fn(),
  stopMutateAsync: vi.fn(),
  setAmpsMutateAsync: vi.fn(),
  setModeMutateAsync: vi.fn(),
  useQuery: vi.fn(),
  addToast: vi.fn(),
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
      command: {
        useMutation: vi.fn((opts: MutationOpts) => {
          // Distinguish start vs stop by inspecting the onMutate setPending call:
          // start uses `"start"`, stop uses `"stop"`. The arrow source contains
          // the literal — read it instead of relying on call order.
          const src = opts.onMutate?.toString() ?? "";
          const isStop = /['"]stop['"]/.test(src);
          if (isStop) {
            hoisted.capturedMutationOptions.stop = opts;
            return { mutateAsync: hoisted.stopMutateAsync };
          }
          hoisted.capturedMutationOptions.start = opts;
          return { mutateAsync: hoisted.startMutateAsync };
        }),
      },
      setAmps: {
        useMutation: vi.fn((opts: MutationOpts) => {
          hoisted.capturedMutationOptions.setAmps = opts;
          return { mutateAsync: hoisted.setAmpsMutateAsync };
        }),
      },
      setMode: {
        useMutation: vi.fn((opts: MutationOpts) => {
          hoisted.capturedMutationOptions.setMode = opts;
          return { mutateAsync: hoisted.setModeMutateAsync };
        }),
      },
    },
    useUtils: vi.fn(() => ({
      vehicle: {
        list: {
          setData: hoisted.setData,
          invalidate: hoisted.invalidate,
        },
      },
    })),
  },
}));

vi.mock("./useToast.tsx", () => ({
  useToast: () => ({
    addToast: hoisted.addToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
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
    hoisted.setData.mockClear();
    hoisted.invalidate.mockClear();
    hoisted.useQuery.mockReset();
    hoisted.useQuery.mockImplementation((_input: unknown, opts: QueryOpts) => {
      hoisted.capturedQueryOptions.current = opts;
      return { data: undefined, isLoading: true, error: null };
    });
    hoisted.addToast.mockClear();
    hoisted.startMutateAsync.mockReset();
    hoisted.stopMutateAsync.mockReset();
    hoisted.setAmpsMutateAsync.mockReset();
    hoisted.setModeMutateAsync.mockReset();
    delete hoisted.capturedMutationOptions.start;
    delete hoisted.capturedMutationOptions.stop;
    delete hoisted.capturedMutationOptions.setAmps;
    delete hoisted.capturedMutationOptions.setMode;
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

  it("startCharging calls command mutation with start", async () => {
    setQuery({ data: [fakeVehicle] });
    hoisted.startMutateAsync.mockResolvedValueOnce({
      success: true,
      state: fakeVehicle.state,
    });

    const { result } = renderHook(() => useVehicles());
    await result.current.startCharging("VIN123");

    expect(hoisted.startMutateAsync).toHaveBeenCalledWith({
      vehicleId: "VIN123",
      command: "start",
    });
  });

  it("stopCharging calls command mutation with stop", async () => {
    setQuery({ data: [fakeVehicle] });
    hoisted.stopMutateAsync.mockResolvedValueOnce({
      success: true,
      state: fakeVehicle.state,
    });

    const { result } = renderHook(() => useVehicles());
    await result.current.stopCharging("VIN123");

    expect(hoisted.stopMutateAsync).toHaveBeenCalledWith({
      vehicleId: "VIN123",
      command: "stop",
    });
  });

  it("setAmps calls setAmps mutation", async () => {
    setQuery({ data: [fakeVehicle] });
    hoisted.setAmpsMutateAsync.mockResolvedValueOnce({
      success: true,
      state: { ...fakeVehicle.state, chargeAmps: 24 },
    });

    const { result } = renderHook(() => useVehicles());
    await result.current.setAmps("VIN123", 24);

    expect(hoisted.setAmpsMutateAsync).toHaveBeenCalledWith({
      vehicleId: "VIN123",
      amps: 24,
    });
  });

  it("changeMode calls setMode mutation", async () => {
    setQuery({ data: [fakeVehicle] });
    hoisted.setModeMutateAsync.mockResolvedValueOnce({
      success: true,
      mode: "auto",
    });

    const { result } = renderHook(() => useVehicles());
    await result.current.changeMode("VIN123", "auto");

    expect(hoisted.setModeMutateAsync).toHaveBeenCalledWith({
      vehicleId: "VIN123",
      mode: "auto",
    });
  });

  it("start command onSuccess updates cache with returned state", () => {
    renderHook(() => useVehicles());

    const opts = hoisted.capturedMutationOptions.start;
    const updatedState = { ...fakeVehicle.state, isCharging: true };
    opts?.onSuccess?.({ success: true, state: updatedState }, {
      vehicleId: "VIN123",
      command: "start",
    });

    expect(hoisted.setData).toHaveBeenCalled();

    const updater = hoisted.setData.mock.calls[0][1] as (
      x: { vehicles: unknown[] },
    ) => { vehicles: Array<{ state: { isCharging: boolean } }> };
    const result = updater({ vehicles: [fakeVehicle] });
    expect(result.vehicles[0].state.isCharging).toBe(true);
  });

  it("command onSuccess with no state does not update cache", () => {
    renderHook(() => useVehicles());

    const opts = hoisted.capturedMutationOptions.start;
    opts?.onSuccess?.({ success: true, state: undefined }, {
      vehicleId: "VIN123",
      command: "start",
    });

    expect(hoisted.setData).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "start command",
      key: "start" as const,
      message: "Vehicle asleep",
      toast: "Failed to start charging: Vehicle asleep",
    },
    {
      name: "stop command",
      key: "stop" as const,
      message: "Timeout",
      toast: "Failed to stop charging: Timeout",
    },
    {
      name: "setMode",
      key: "setMode" as const,
      message: "Not authorized",
      toast: "Failed to change mode: Not authorized",
    },
    {
      name: "setAmps",
      key: "setAmps" as const,
      message: "Rate limited",
      toast: "Failed to set amps: Rate limited",
    },
  ])("$name onError calls addToast", ({ key, message, toast }) => {
    renderHook(() => useVehicles());

    const opts = hoisted.capturedMutationOptions[key];
    opts?.onError?.({ message });

    expect(hoisted.addToast).toHaveBeenCalledWith(toast, "error");
  });

  it("setMode onSuccess updates mode in cache", () => {
    renderHook(() => useVehicles());

    const opts = hoisted.capturedMutationOptions.setMode;
    opts?.onSuccess?.(
      { success: true, mode: "auto" },
      { vehicleId: "VIN123", mode: "auto" },
    );

    expect(hoisted.setData).toHaveBeenCalled();

    const updater = hoisted.setData.mock.calls[0][1] as (
      x: { vehicles: unknown[] },
    ) => { vehicles: Array<{ mode: string }> };
    const result = updater({ vehicles: [fakeVehicle] });
    expect(result.vehicles[0].mode).toBe("auto");
  });

  it("refreshVehicles calls invalidate", () => {
    const { result } = renderHook(() => useVehicles());
    result.current.refreshVehicles();

    expect(hoisted.invalidate).toHaveBeenCalledTimes(1);
  });

  it("commandPending defaults to false for vehicles", () => {
    setQuery({ data: [fakeVehicle] });

    const { result } = renderHook(() => useVehicles());

    expect(result.current.commandPending["VIN123"]).toBe(false);
  });
});
