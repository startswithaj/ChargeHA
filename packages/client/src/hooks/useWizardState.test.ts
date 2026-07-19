import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";
import type { WizardNavState } from "@chargeha/shared";

const hoisted = vi.hoisted(() => ({
  state: {
    data: undefined as
      | { stepId: string; vehicleType: string; energyType: string }
      | undefined,
    isLoading: false,
  },
  mutate: vi.fn(),
  cancel: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: () => ({
      wizard: {
        state: {
          cancel: hoisted.cancel,
          setData: hoisted.setData,
          invalidate: hoisted.invalidate,
        },
      },
    }),
    wizard: {
      state: {
        useQuery: () => ({
          data: hoisted.state.data,
          isLoading: hoisted.state.isLoading,
        }),
      },
      patchState: {
        useMutation: () => ({ mutate: hoisted.mutate }),
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

  /** Run the updater the hook handed to setData against a starting state. */
  const applyOptimisticWrite = (prev: WizardNavState | undefined) => {
    const updater = hoisted.setData.mock.calls.at(-1)?.[1] as (
      p: WizardNavState | undefined,
    ) => WizardNavState;
    return updater(prev);
  };

  beforeEach(() => {
    hoisted.state.data = undefined;
    hoisted.state.isLoading = false;
    hoisted.mutate.mockClear();
    hoisted.cancel.mockClear();
    hoisted.setData.mockClear();
  });

  it("starts at welcome when the query has no data", () => {
    const { result } = setup();

    expect(result.current.state).toEqual({
      stepId: "welcome",
      vehicleType: "",
      energyType: "",
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("exposes query data as the store's state", () => {
    hoisted.state.data = {
      stepId: "tesla-credentials",
      vehicleType: "tesla",
      energyType: "fronius_local",
    };

    const { result } = setup();

    expect(result.current.state).toEqual({
      stepId: "tesla-credentials",
      vehicleType: "tesla",
      energyType: "fronius_local",
    });
  });

  it("isLoading is true while the state query is loading", () => {
    hoisted.state.isLoading = true;

    const { result } = setup();

    expect(result.current.isLoading).toBe(true);
  });

  it("patch persists the change and writes the cache optimistically", () => {
    const { result } = setup();

    act(() => {
      result.current.patch({ stepId: "authentication" });
    });

    expect(hoisted.mutate).toHaveBeenCalledWith(
      { stepId: "authentication" },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(hoisted.cancel).toHaveBeenCalled();
    expect(
      applyOptimisticWrite({
        stepId: "welcome",
        vehicleType: "tesla",
        energyType: "",
      }),
    ).toEqual({
      stepId: "authentication",
      vehicleType: "tesla",
      energyType: "",
    });
  });

  it("refetches server state when the patch fails", () => {
    const { result } = setup();

    act(() => {
      result.current.patch({ stepId: "authentication" });
    });

    // The optimistic write left the client on a step the server never stored;
    // without the refetch it survives until the next load, then jumps back.
    const opts = hoisted.mutate.mock.calls.at(-1)?.[1] as {
      onError: () => void;
    };
    expect(hoisted.invalidate).not.toHaveBeenCalled();
    act(() => {
      opts.onError();
    });
    expect(hoisted.invalidate).toHaveBeenCalled();
  });

  it("carries a selection and its step in a single mutation", () => {
    const { result } = setup();

    act(() => {
      result.current.patch({
        energyType: "fronius_local",
        stepId: "fronius-local-setup",
      });
    });

    // One mutation carries both fields — they cannot land in separate renders.
    expect(hoisted.mutate).toHaveBeenCalledTimes(1);
    expect(hoisted.mutate).toHaveBeenCalledWith(
      { energyType: "fronius_local", stepId: "fronius-local-setup" },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("merges over prior state, leaving omitted fields alone", () => {
    const { result } = setup();

    act(() => {
      result.current.patch({
        vehicleType: "tesla",
        stepId: "tesla-key-generation",
      });
    });

    // The step and the type that puts it in the list are written together, and
    // energyType — not part of this selection — survives untouched.
    expect(
      applyOptimisticWrite({
        stepId: "vehicle-type",
        vehicleType: "",
        energyType: "fronius_local",
      }),
    ).toEqual({
      stepId: "tesla-key-generation",
      vehicleType: "tesla",
      energyType: "fronius_local",
    });
  });

  it("optimistic write falls back to empty state before the query resolves", () => {
    const { result } = setup();

    act(() => {
      result.current.patch({ stepId: "welcome" });
    });

    expect(applyOptimisticWrite(undefined)).toEqual({
      stepId: "welcome",
      vehicleType: "",
      energyType: "",
    });
  });
});
