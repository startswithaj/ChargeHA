import { assertExists } from "@std/assert";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

type OnMutate = ((vars: Record<string, unknown>) => void) | undefined;

const hoisted = vi.hoisted(() => ({
  state: {
    stepData: undefined as string | undefined,
    vehicleTypeData: undefined as string | undefined,
    energyTypeData: undefined as string | undefined,
    stepLoading: false,
    vehicleTypeLoading: false,
    energyTypeLoading: false,
  },
  mutates: {
    step: vi.fn(),
    vehicleType: vi.fn(),
    energyType: vi.fn(),
  },
  captured: {
    stepOnMutate: undefined as OnMutate,
    vehicleTypeOnMutate: undefined as OnMutate,
    energyTypeOnMutate: undefined as OnMutate,
  },
  cancel: vi.fn(),
  setData: vi.fn(),
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: () => ({
      wizard: {
        getStep: { cancel: hoisted.cancel, setData: hoisted.setData },
        getVehicleType: { cancel: hoisted.cancel, setData: hoisted.setData },
        getEnergyType: { cancel: hoisted.cancel, setData: hoisted.setData },
      },
    }),
    wizard: {
      getStep: {
        useQuery: () => ({
          data: hoisted.state.stepData,
          isLoading: hoisted.state.stepLoading,
        }),
      },
      getVehicleType: {
        useQuery: () => ({
          data: hoisted.state.vehicleTypeData,
          isLoading: hoisted.state.vehicleTypeLoading,
        }),
      },
      getEnergyType: {
        useQuery: () => ({
          data: hoisted.state.energyTypeData,
          isLoading: hoisted.state.energyTypeLoading,
        }),
      },
      setStep: {
        useMutation: (opts: Record<string, unknown>) => {
          hoisted.captured.stepOnMutate = opts.onMutate as OnMutate;
          return { mutate: hoisted.mutates.step };
        },
      },
      setVehicleType: {
        useMutation: (opts: Record<string, unknown>) => {
          hoisted.captured.vehicleTypeOnMutate = opts.onMutate as OnMutate;
          return { mutate: hoisted.mutates.vehicleType };
        },
      },
      setEnergyType: {
        useMutation: (opts: Record<string, unknown>) => {
          hoisted.captured.energyTypeOnMutate = opts.onMutate as OnMutate;
          return { mutate: hoisted.mutates.energyType };
        },
      },
    },
  },
}));

import { useWizardState } from "./useWizardState.ts";

describe("useWizardState", () => {
  const createWrapper = () => {
    const qc = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
  };

  const setup = () =>
    renderHook(() => useWizardState(), { wrapper: createWrapper() });

  beforeEach(() => {
    hoisted.state.stepData = undefined;
    hoisted.state.vehicleTypeData = undefined;
    hoisted.state.energyTypeData = undefined;
    hoisted.state.stepLoading = false;
    hoisted.state.vehicleTypeLoading = false;
    hoisted.state.energyTypeLoading = false;
    hoisted.mutates.step.mockClear();
    hoisted.mutates.vehicleType.mockClear();
    hoisted.mutates.energyType.mockClear();
    hoisted.cancel.mockClear();
    hoisted.setData.mockClear();
    hoisted.captured.stepOnMutate = undefined;
    hoisted.captured.vehicleTypeOnMutate = undefined;
    hoisted.captured.energyTypeOnMutate = undefined;
  });

  it("returns default values when queries have no data", () => {
    const { result } = setup();

    expect(result.current.stepId).toBe("welcome");
    expect(result.current.vehicleType).toBe("");
    expect(result.current.energyType).toBe("");
    expect(result.current.isLoading).toBe(false);
  });

  it("returns query data when available", () => {
    hoisted.state.stepData = "tesla-credentials";
    hoisted.state.vehicleTypeData = "tesla";
    hoisted.state.energyTypeData = "fronius_local";

    const { result } = setup();

    expect(result.current.stepId).toBe("tesla-credentials");
    expect(result.current.vehicleType).toBe("tesla");
    expect(result.current.energyType).toBe("fronius_local");
  });

  it.each<{
    name: string;
    setLoading: () => void;
  }>([
    { name: "step", setLoading: () => (hoisted.state.stepLoading = true) },
    {
      name: "vehicleType",
      setLoading: () => (hoisted.state.vehicleTypeLoading = true),
    },
    {
      name: "energyType",
      setLoading: () => (hoisted.state.energyTypeLoading = true),
    },
  ])("isLoading is true when $name query is loading", ({ setLoading }) => {
    setLoading();

    const { result } = setup();

    expect(result.current.isLoading).toBe(true);
  });

  it.each<{
    name: string;
    call: (r: ReturnType<typeof useWizardState>) => void;
    mock: () => ReturnType<typeof vi.fn>;
    expectArg: Record<string, string>;
  }>([
    {
      name: "setStepId",
      call: (r) => r.setStepId("authentication"),
      mock: () => hoisted.mutates.step,
      expectArg: { stepId: "authentication" },
    },
    {
      name: "setVehicleType",
      call: (r) => r.setVehicleType("tesla"),
      mock: () => hoisted.mutates.vehicleType,
      expectArg: { type: "tesla" },
    },
    {
      name: "setEnergyType",
      call: (r) => r.setEnergyType("fronius_local"),
      mock: () => hoisted.mutates.energyType,
      expectArg: { type: "fronius_local" },
    },
  ])("$name calls mutation with correct args", ({ call, mock, expectArg }) => {
    const { result } = setup();

    act(() => {
      call(result.current);
    });

    expect(mock()).toHaveBeenCalledWith(expectArg);
  });

  it.each<{
    name: string;
    captured: () => OnMutate;
    args: Record<string, string>;
    expected: string;
  }>([
    {
      name: "step",
      captured: () => hoisted.captured.stepOnMutate,
      args: { stepId: "timezone" },
      expected: "timezone",
    },
    {
      name: "vehicleType",
      captured: () => hoisted.captured.vehicleTypeOnMutate,
      args: { type: "simulated" },
      expected: "simulated",
    },
    {
      name: "energyType",
      captured: () => hoisted.captured.energyTypeOnMutate,
      args: { type: "fronius_cloud" },
      expected: "fronius_cloud",
    },
  ])(
    "$name onMutate cancels query and sets data optimistically",
    async ({ captured, args, expected }) => {
      setup();

      const fn = captured();
      assertExists(fn);
      await fn(args);

      expect(hoisted.cancel).toHaveBeenCalled();
      expect(hoisted.setData).toHaveBeenCalledWith(undefined, expected);
    },
  );
});
