import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

type MutationOpts = Record<string, unknown>;

const hoisted = vi.hoisted(() => {
  type MockedMutation = ReturnType<typeof vi.fn> & { opts?: MutationOpts };

  const make = (): MockedMutation =>
    Object.assign(vi.fn(), { opts: undefined });

  return {
    listQuery: vi.fn(),
    createMutation: make(),
    updateMutation: make(),
    toggleMutation: make(),
    deleteMutation: make(),
    listSetData: vi.fn(),
    listGetData: vi.fn(),
    listCancel: vi.fn(),
  };
});

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    schedule: {
      list: {
        useQuery: () => hoisted.listQuery(),
      },
      create: {
        useMutation: (opts: MutationOpts) => {
          hoisted.createMutation.opts = opts;
          return {
            mutateAsync: hoisted.createMutation,
            reset: vi.fn(),
          };
        },
      },
      update: {
        useMutation: (opts: MutationOpts) => {
          // The toggle mutation registers with onMutate (optimistic update);
          // the plain update mutation registers with onSuccess only. Key by
          // that shape rather than call order.
          const isToggle = typeof opts.onMutate === "function";
          const target = isToggle
            ? hoisted.toggleMutation
            : hoisted.updateMutation;
          target.opts = opts;
          return {
            mutateAsync: target,
            mutate: target,
            reset: vi.fn(),
          };
        },
      },
      delete: {
        useMutation: (opts: MutationOpts) => {
          hoisted.deleteMutation.opts = opts;
          return {
            mutate: hoisted.deleteMutation,
            reset: vi.fn(),
          };
        },
      },
    },
    useUtils: () => ({
      schedule: {
        list: {
          setData: hoisted.listSetData,
          getData: hoisted.listGetData,
          cancel: hoisted.listCancel,
        },
      },
    }),
  },
}));

import { useSchedules } from "./useSchedules.ts";

describe("useSchedules", () => {
  const fakeChargeSchedule = {
    id: "sched-1",
    scheduleType: "charge" as const,
    vehicleId: "VIN123",
    days: ["mon", "tue", "wed"] as Array<"mon" | "tue" | "wed">,
    startTime: "22:00",
    endTime: "06:00",
    enabled: true,
    chargeAmps: 16,
    chargeLimitPct: 80,
  };

  const fakeBlockoutSchedule = {
    id: "sched-2",
    scheduleType: "blockout" as const,
    vehicleId: null,
    days: ["sat", "sun"] as Array<"sat" | "sun">,
    startTime: "08:00",
    endTime: "18:00",
    enabled: true,
  };

  const baseChargeInput = {
    scheduleType: "charge" as const,
    vehicleId: "VIN123",
    chargeAmps: 16,
    chargeLimitPct: 80,
  };

  const createWrapper = () => {
    const qc = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
  };

  type Schedule = typeof fakeChargeSchedule | typeof fakeBlockoutSchedule;

  const setSchedules = (schedules: Schedule[] | undefined, isLoading = false) =>
    hoisted.listQuery.mockReturnValue({
      data: schedules ? { schedules } : undefined,
      isLoading,
    });

  const setup = (schedules: Schedule[] = []) => {
    setSchedules(schedules);
    return renderHook(() => useSchedules(), { wrapper: createWrapper() });
  };

  const addSchedule = async (
    result: ReturnType<typeof useSchedules>,
    input: Parameters<ReturnType<typeof useSchedules>["addSchedule"]>[0],
  ) => {
    let error: string | null = null;
    await act(async () => {
      error = await result.addSchedule(input);
    });
    return error;
  };

  const updateSchedule = async (
    result: ReturnType<typeof useSchedules>,
    id: string,
    input: Parameters<ReturnType<typeof useSchedules>["updateSchedule"]>[1],
  ) => {
    let error: string | null = null;
    await act(async () => {
      error = await result.updateSchedule(id, input);
    });
    return error;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.listQuery.mockReturnValue({ data: undefined, isLoading: true });
  });

  it("starts with loading=true", () => {
    const { result } = renderHook(() => useSchedules(), {
      wrapper: createWrapper(),
    });
    expect(result.current.loading).toBe(true);
  });

  it("loads schedules on mount from tRPC query", () => {
    const { result } = setup([fakeChargeSchedule, fakeBlockoutSchedule]);

    expect(result.current.loading).toBe(false);
    expect(result.current.schedules).toHaveLength(2);
  });

  it("separates charge and blockout schedules", () => {
    const { result } = setup([fakeChargeSchedule, fakeBlockoutSchedule]);

    expect(result.current.chargeSchedules).toHaveLength(1);
    expect(result.current.chargeSchedules[0].id).toBe("sched-1");
    expect(result.current.blockoutSchedules).toHaveLength(1);
    expect(result.current.blockoutSchedules[0].id).toBe("sched-2");
  });

  it("addSchedule creates schedule via tRPC and updates cache", async () => {
    const { result } = setup([]);

    const newScheduleData = {
      ...baseChargeInput,
      days: ["fri"] as Array<"fri">,
      startTime: "20:00",
      endTime: "04:00",
      chargeAmps: 10,
    };

    hoisted.createMutation.mockResolvedValueOnce({
      schedule: { ...newScheduleData, id: "sched-new", enabled: true },
    });

    const error = await addSchedule(result.current, newScheduleData);

    expect(error).toBeNull();
    expect(hoisted.createMutation).toHaveBeenCalledWith(newScheduleData);
  });

  it("addSchedule returns overlap error for overlapping charge schedules", async () => {
    const { result } = setup([fakeChargeSchedule]);

    const overlappingData = {
      ...baseChargeInput,
      days: ["mon"] as Array<"mon">,
      startTime: "23:00",
      endTime: "07:00",
      chargeAmps: 12,
    };

    const error = await addSchedule(result.current, overlappingData);

    expect(error).toBe(
      "This schedule overlaps with an existing charge schedule for the same vehicle.",
    );
    expect(hoisted.createMutation).not.toHaveBeenCalled();
  });

  it("updateSchedule updates schedule via tRPC", async () => {
    const { result } = setup([fakeChargeSchedule]);

    hoisted.updateMutation.mockResolvedValueOnce({
      schedule: { ...fakeChargeSchedule, chargeAmps: 24 },
    });

    const updateData = {
      ...baseChargeInput,
      days: ["mon", "tue", "wed"] as Array<"mon" | "tue" | "wed">,
      startTime: "22:00",
      endTime: "06:00",
      chargeAmps: 24,
    };

    const error = await updateSchedule(result.current, "sched-1", updateData);

    expect(error).toBeNull();
    expect(hoisted.updateMutation).toHaveBeenCalledWith({
      id: "sched-1",
      ...updateData,
    });
  });

  it("toggleSchedule calls update mutation with id and enabled", () => {
    const { result } = setup([fakeChargeSchedule]);

    act(() => {
      result.current.toggleSchedule("sched-1", false);
    });

    expect(hoisted.toggleMutation).toHaveBeenCalledWith({
      id: "sched-1",
      enabled: false,
    });
  });

  it("removeSchedule calls delete mutation with id", () => {
    const { result } = setup([fakeChargeSchedule, fakeBlockoutSchedule]);

    act(() => {
      result.current.removeSchedule("sched-1");
    });

    expect(hoisted.deleteMutation).toHaveBeenCalledWith({ id: "sched-1" });
  });

  it("handles empty data gracefully", () => {
    setSchedules(undefined);

    const { result } = renderHook(() => useSchedules(), {
      wrapper: createWrapper(),
    });

    expect(result.current.schedules).toHaveLength(0);
  });

  it("addSchedule skips overlap validation for blockout schedules", async () => {
    const { result } = setup([fakeChargeSchedule]);

    const blockoutData = {
      scheduleType: "blockout" as const,
      vehicleId: null,
      days: ["mon"] as Array<"mon">,
      startTime: "22:00",
      endTime: "06:00",
      chargeAmps: 0,
      chargeLimitPct: 0,
    };

    hoisted.createMutation.mockResolvedValueOnce({
      schedule: { ...blockoutData, id: "sched-blockout-new", enabled: true },
    });

    const error = await addSchedule(result.current, blockoutData);

    expect(error).toBeNull();
    expect(hoisted.createMutation).toHaveBeenCalledWith(blockoutData);
  });

  it.each([
    { rejected: new Error("API timeout"), expected: "API timeout" },
    { rejected: "string error", expected: "Failed to create schedule" },
  ])(
    "addSchedule maps $expected from $rejected",
    async ({ rejected, expected }) => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(
        () => {},
      );
      const { result } = setup([]);

      const newScheduleData = {
        ...baseChargeInput,
        days: ["mon"] as Array<"mon">,
        startTime: "08:00",
        endTime: "12:00",
      };

      hoisted.createMutation.mockRejectedValueOnce(rejected);

      const error = await addSchedule(result.current, newScheduleData);

      expect(error).toBe(expected);
      consoleSpy.mockRestore();
    },
  );

  it.each([
    {
      rejected: new Error("Update failed on server"),
      expected: "Update failed on server",
    },
    { rejected: 42, expected: "Failed to update schedule" },
  ])(
    "updateSchedule maps $expected from $rejected",
    async ({ rejected, expected }) => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(
        () => {},
      );
      const { result } = setup([fakeChargeSchedule]);

      hoisted.updateMutation.mockRejectedValueOnce(rejected);

      const updateData = {
        ...baseChargeInput,
        days: ["mon", "tue", "wed"] as Array<"mon" | "tue" | "wed">,
        startTime: "22:00",
        endTime: "06:00",
      };

      const error = await updateSchedule(result.current, "sched-1", updateData);

      expect(error).toBe(expected);
      consoleSpy.mockRestore();
    },
  );

  it("updateSchedule returns overlap error for overlapping charge schedules", async () => {
    const secondChargeSchedule = {
      ...fakeChargeSchedule,
      id: "sched-3",
      startTime: "10:00",
      endTime: "14:00",
      days: ["mon", "tue"] as Array<"mon" | "tue">,
    };

    const { result } = setup([fakeChargeSchedule, secondChargeSchedule]);

    const updateData = {
      ...baseChargeInput,
      days: ["mon"] as Array<"mon">,
      startTime: "23:00",
      endTime: "07:00",
    };

    const error = await updateSchedule(result.current, "sched-3", updateData);

    expect(error).toBe(
      "This schedule overlaps with an existing charge schedule for the same vehicle.",
    );
  });

  it.each([
    {
      name: "non-overlapping time range, same vehicle",
      existing: [fakeChargeSchedule],
      input: {
        ...baseChargeInput,
        days: ["mon"] as Array<"mon">,
        startTime: "08:00",
        endTime: "12:00",
      },
    },
    {
      name: "different days even with same time",
      existing: [fakeChargeSchedule],
      input: {
        ...baseChargeInput,
        days: ["sat", "sun"] as Array<"sat" | "sun">,
        startTime: "22:00",
        endTime: "06:00",
      },
    },
    {
      name: "different vehicle with overlapping time",
      existing: [fakeChargeSchedule],
      input: {
        ...baseChargeInput,
        vehicleId: "VIN-OTHER",
        days: ["mon"] as Array<"mon">,
        startTime: "22:00",
        endTime: "06:00",
      },
    },
    {
      name: "non-overlapping normal (non-overnight) time ranges",
      existing: [
        { ...fakeChargeSchedule, startTime: "08:00", endTime: "12:00" },
      ],
      input: {
        ...baseChargeInput,
        days: ["fri"] as Array<"fri">,
        startTime: "10:00",
        endTime: "14:00",
      },
    },
  ])("addSchedule allows $name", async ({ existing, input }) => {
    const { result } = setup(existing);

    hoisted.createMutation.mockResolvedValueOnce({
      schedule: { ...input, id: "sched-new", enabled: true },
    });

    const error = await addSchedule(result.current, input);

    expect(error).toBeNull();
    expect(hoisted.createMutation).toHaveBeenCalled();
  });

  it("overlap validation with normal (non-overnight) overlapping range", async () => {
    const normalSchedule = {
      ...fakeChargeSchedule,
      startTime: "08:00",
      endTime: "12:00",
    };

    const { result } = setup([normalSchedule]);

    const overlappingData = {
      ...baseChargeInput,
      days: ["mon"] as Array<"mon">,
      startTime: "10:00",
      endTime: "14:00",
    };

    const error = await addSchedule(result.current, overlappingData);

    expect(error).toBe(
      "This schedule overlaps with an existing charge schedule for the same vehicle.",
    );
  });

  it("updateSchedule excludes own id from overlap check", async () => {
    const { result } = setup([fakeChargeSchedule]);

    hoisted.updateMutation.mockResolvedValueOnce({
      schedule: { ...fakeChargeSchedule, startTime: "21:00", endTime: "05:00" },
    });

    const updateData = {
      ...baseChargeInput,
      days: ["mon", "tue", "wed"] as Array<"mon" | "tue" | "wed">,
      startTime: "21:00",
      endTime: "05:00",
    };

    const error = await updateSchedule(result.current, "sched-1", updateData);

    expect(error).toBeNull();
    expect(hoisted.updateMutation).toHaveBeenCalled();
  });
});
