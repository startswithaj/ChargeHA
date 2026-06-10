import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useVehicleSettings } from "./useVehicleSettings.ts";

const {
  mockDeleteMutate,
  mockPriorityMutateAsync,
  mockCreateMutate,
  mockInvalidateVehicleList,
  c,
  m,
} = vi.hoisted(() => ({
  mockDeleteMutate: vi.fn(),
  mockPriorityMutateAsync: vi.fn(),
  mockCreateMutate: vi.fn(),
  mockInvalidateVehicleList: vi.fn(),
  c: {
    deleteOpts: {} as { onSuccess?: () => void },
    priorityMutationOpts: {} as {
      mutationFn?: (updates: unknown) => Promise<void>;
      onSuccess?: () => void;
    },
    addSimOpts: {} as {
      mutationFn?: () => Promise<string>;
      onSuccess?: (id: string) => void;
    },
  },
  m: {
    vehiclesData: undefined as unknown,
    vehiclesPending: false,
    vehiclesError: null as { message: string } | null,
    vehiclesIsError: false,
    encryptionData: undefined as { configured: boolean } | undefined,
    pluginsData: undefined as unknown[] | undefined,
    homeConfigData: undefined as
      | { homeLatitude?: number; homeLongitude?: number }
      | undefined,
    deleteError: null as { message: string } | null,
    priorityError: null as { message: string } | null,
    addSimError: null as { message: string } | null,
  },
}));

vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useHomeConfig: () => ({ data: m.homeConfigData }),
}));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: () => ({
      vehicle: {
        list: { invalidate: mockInvalidateVehicleList },
      },
      client: {
        vehicle: {
          create: { mutate: mockCreateMutate },
        },
      },
    }),
    vehicle: {
      list: {
        useQuery: vi.fn((
          _input: unknown,
          opts?: { select?: (data: unknown) => unknown },
        ) => ({
          data: (() => {
            if (!m.vehiclesData) return undefined;
            return opts?.select ? opts.select(m.vehiclesData) : m.vehiclesData;
          })(),
          isPending: m.vehiclesPending,
          isError: m.vehiclesIsError,
          error: m.vehiclesError,
        })),
      },
      delete: {
        useMutation: vi.fn((opts?: { onSuccess?: () => void }) => {
          c.deleteOpts = opts ?? {};
          return {
            mutate: mockDeleteMutate,
            error: m.deleteError,
          };
        }),
      },
      setPriority: {
        useMutation: vi.fn(() => ({
          mutateAsync: mockPriorityMutateAsync,
        })),
      },
      getPlugins: {
        useQuery: vi.fn(() => ({
          data: m.pluginsData,
        })),
      },
    },
    health: {
      encryption: {
        useQuery: vi.fn(() => ({
          data: m.encryptionData,
        })),
      },
    },
  },
}));

// Mock @tanstack/react-query useMutation to capture mutationFn and onSuccess
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: vi.fn((opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
    }) => {
      // Distinguish between priority mutation and addSim mutation by checking
      // if the mutationFn accepts arguments
      const fnStr = opts.mutationFn.toString();
      if (fnStr.includes("updates") || fnStr.includes("Promise.all")) {
        c.priorityMutationOpts = opts as typeof c.priorityMutationOpts;
        return {
          mutate: vi.fn((updates: unknown) => {
            opts.mutationFn(updates);
          }),
          error: m.priorityError,
        };
      }
      c.addSimOpts = opts as typeof c.addSimOpts;
      return {
        mutate: vi.fn(() => {
          opts.mutationFn().then((id: unknown) => {
            opts.onSuccess?.(id as string);
          });
        }),
        error: m.addSimError,
      };
    }),
  };
});

describe("useVehicleSettings", () => {
  beforeEach(() => {
    m.vehiclesData = undefined;
    m.vehiclesPending = false;
    m.vehiclesError = null;
    m.vehiclesIsError = false;
    m.encryptionData = undefined;
    m.pluginsData = undefined;
    m.homeConfigData = undefined;
    m.deleteError = null;
    m.priorityError = null;
    m.addSimError = null;
    c.deleteOpts = {};
    c.priorityMutationOpts = {};
    c.addSimOpts = {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns loading state when vehicles query is pending", () => {
    m.vehiclesPending = true;
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.loading).toBe(true);
  });

  it("returns empty vehicles when no data", () => {
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.vehicles).toEqual([]);
  });

  it("returns vehicles from query", () => {
    m.vehiclesData = {
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
      ],
    };
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].id).toBe("VIN1");
  });

  it("returns encryptionMissing when not configured", () => {
    m.encryptionData = { configured: false };
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.encryptionMissing).toBe(true);
  });

  it("returns encryptionMissing false when configured", () => {
    m.encryptionData = { configured: true };
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.encryptionMissing).toBe(false);
  });

  it("handleDelete calls delete mutation", () => {
    const { result } = renderHook(() => useVehicleSettings());
    result.current.handleDelete("VIN1");
    expect(mockDeleteMutate).toHaveBeenCalledWith({ vehicleId: "VIN1" });
  });

  it("delete mutation onSuccess invalidates vehicle list", () => {
    renderHook(() => useVehicleSettings());
    c.deleteOpts.onSuccess?.();
    expect(mockInvalidateVehicleList).toHaveBeenCalled();
  });

  it("handleMovePriority swaps vehicles up via priority mutationFn", () => {
    m.vehiclesData = {
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
        { id: "VIN2", name: "Model Y", adapterType: "tesla", priority: 2 },
      ],
    };
    const { result } = renderHook(() => useVehicleSettings());
    result.current.handleMovePriority("VIN2", "up");
    expect(mockPriorityMutateAsync).toHaveBeenCalled();
  });

  it.each<[string, string, "up" | "down"]>([
    ["invalid vin", "NONEXISTENT", "up"],
    ["first vehicle up", "VIN1", "up"],
    ["last vehicle down", "VIN2", "down"],
  ])("handleMovePriority ignores %s", (_label, vin, direction) => {
    m.vehiclesData = {
      vehicles: [
        { id: "VIN1", name: "Model 3", adapterType: "tesla", priority: 1 },
        { id: "VIN2", name: "Model Y", adapterType: "tesla", priority: 2 },
      ],
    };
    const { result } = renderHook(() => useVehicleSettings());
    result.current.handleMovePriority(vin, direction);
    expect(mockPriorityMutateAsync).not.toHaveBeenCalled();
  });

  it("returns loadFailed when query errors", () => {
    m.vehiclesIsError = true;
    m.vehiclesError = { message: "Network error" };
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.loadFailed).toBe(true);
  });

  it("returns display error from vehicle query", () => {
    m.vehiclesError = { message: "Network error" };
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.error).toBe("Network error");
  });

  it("returns vehiclePlugins from query", () => {
    m.pluginsData = [
      { id: "tesla", displayName: "Tesla", configured: true },
    ];
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.vehiclePlugins).toHaveLength(1);
  });

  it("returns empty vehiclePlugins when no data", () => {
    const { result } = renderHook(() => useVehicleSettings());
    expect(result.current.vehiclePlugins).toEqual([]);
  });

  it("handleStartOnboarding navigates to setup path", () => {
    const pushStateSpy = vi.spyOn(globalThis.history, "pushState");
    const { result } = renderHook(() => useVehicleSettings());

    result.current.handleStartOnboarding("tesla");

    expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/setup/tesla");

    pushStateSpy.mockRestore();
  });

  it("handleAddSimulatedVehicle creates simulated vehicle without home location", async () => {
    mockCreateMutate.mockResolvedValue(undefined);
    m.homeConfigData = undefined;
    const { result } = renderHook(() => useVehicleSettings());
    await act(() => {
      result.current.handleAddSimulatedVehicle();
    });
    expect(mockCreateMutate).toHaveBeenCalled();
    const callArg = mockCreateMutate.mock.calls[0]?.[0] as { config: string };
    const parsed = JSON.parse(callArg.config);
    expect(parsed.homeLat).toBeUndefined();
  });

  it("handleAddSimulatedVehicle includes home location when configured", async () => {
    mockCreateMutate.mockResolvedValue(undefined);
    m.homeConfigData = { homeLatitude: -33.86, homeLongitude: 151.20 };
    const { result } = renderHook(() => useVehicleSettings());
    await act(() => {
      result.current.handleAddSimulatedVehicle();
    });
    expect(mockCreateMutate).toHaveBeenCalled();
    const callArg = mockCreateMutate.mock.calls[0]?.[0] as { config: string };
    const parsed = JSON.parse(callArg.config);
    expect(parsed.homeLat).toBe(-33.86);
    expect(parsed.homeLng).toBe(151.20);
  });
});
