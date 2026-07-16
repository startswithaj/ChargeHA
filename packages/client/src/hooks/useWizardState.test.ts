import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

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
        useMutation: () => ({ mutate: hoisted.mutates.step }),
      },
      setVehicleType: {
        useMutation: () => ({ mutate: hoisted.mutates.vehicleType }),
      },
      setEnergyType: {
        useMutation: () => ({ mutate: hoisted.mutates.energyType }),
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

  it("setStepId persists the step and writes the cache optimistically", () => {
    const { result } = setup();

    act(() => {
      result.current.setStepId("authentication");
    });

    expect(hoisted.mutates.step).toHaveBeenCalledWith({
      stepId: "authentication",
    });
    // Optimistic write is synchronous (not deferred behind an awaited cancel).
    expect(hoisted.cancel).toHaveBeenCalled();
    expect(hoisted.setData).toHaveBeenCalledWith(undefined, "authentication");
  });

  it("commitSelection writes step + energy caches synchronously in one call", () => {
    const { result } = setup();

    act(() => {
      result.current.commitSelection({
        energyType: "fronius_local",
        stepId: "fronius-local-setup",
      });
    });

    expect(hoisted.mutates.step).toHaveBeenCalledWith({
      stepId: "fronius-local-setup",
    });
    expect(hoisted.mutates.energyType).toHaveBeenCalledWith({
      type: "fronius_local",
    });
    // Both caches are written synchronously so React commits them together.
    expect(hoisted.setData).toHaveBeenCalledWith(
      undefined,
      "fronius-local-setup",
    );
    expect(hoisted.setData).toHaveBeenCalledWith(undefined, "fronius_local");
    // vehicleType is untouched when not provided.
    expect(hoisted.mutates.vehicleType).not.toHaveBeenCalled();
  });

  it("commitSelection persists the vehicle type when provided", () => {
    const { result } = setup();

    act(() => {
      result.current.commitSelection({
        vehicleType: "tesla",
        stepId: "tesla-credentials",
      });
    });

    expect(hoisted.mutates.vehicleType).toHaveBeenCalledWith({ type: "tesla" });
    expect(hoisted.mutates.step).toHaveBeenCalledWith({
      stepId: "tesla-credentials",
    });
    expect(hoisted.mutates.energyType).not.toHaveBeenCalled();
  });
});
