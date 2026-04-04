import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

// ── tRPC mock ───────────────────────────────────────────────────────────────
// vi.mock factory is hoisted — use vi.hoisted() to declare shared mocks.

const {
  mockInvalidate,
  mockUseQuery,
  mockUseMutation,
  capturedOptsRef,
} = vi.hoisted(() => {
  const mockInvalidate = vi.fn();
  const mockUseQuery = vi.fn(() => ({ data: undefined, isLoading: false }));
  const capturedOptsRef: {
    current: {
      onMutate?: () => void;
      onSuccess?: () => void;
      onError?: (err: unknown) => void;
    };
  } = { current: {} };
  const mockUseMutation = vi.fn(
    (opts: {
      onMutate?: () => void;
      onSuccess?: () => void;
      onError?: (err: unknown) => void;
    }) => {
      capturedOptsRef.current = opts;
      return { mutate: vi.fn(), mutateAsync: vi.fn() };
    },
  );
  return { mockInvalidate, mockUseQuery, mockUseMutation, capturedOptsRef };
});

vi.mock("../trpc.ts", () => {
  const makeConfigSection = () => {
    return {
      get: { useQuery: mockUseQuery, invalidate: mockInvalidate },
      set: { useMutation: mockUseMutation },
    };
  };

  return {
    trpc: {
      useUtils: () => ({
        config: {
          charging: { get: { invalidate: mockInvalidate } },
          solar: { get: { invalidate: mockInvalidate } },
          battery: { get: { invalidate: mockInvalidate } },
          home: { get: { invalidate: mockInvalidate } },
          equipment: { get: { invalidate: mockInvalidate } },
          system: { get: { invalidate: mockInvalidate } },
          notification: { get: { invalidate: mockInvalidate } },
        },
      }),
      config: {
        charging: makeConfigSection(),
        solar: makeConfigSection(),
        battery: makeConfigSection(),
        home: makeConfigSection(),
        equipment: makeConfigSection(),
        system: makeConfigSection(),
        notification: makeConfigSection(),
      },
    },
  };
});

import {
  useBatteryConfig,
  useBatteryConfigMutation,
  useChargingConfig,
  useChargingConfigMutation,
  useEquipmentConfig,
  useEquipmentConfigMutation,
  useHomeConfig,
  useHomeConfigMutation,
  useNotificationConfig,
  useNotificationConfigMutation,
  useSolarConfig,
  useSolarConfigMutation,
  useSystemConfig,
  useSystemConfigMutation,
} from "./useSectionConfig.ts";

describe("config query hooks", () => {
  const createWrapper = () => {
    const qc = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
  };

  beforeEach(() => {
    mockUseQuery.mockClear();
  });

  it.each([
    { name: "useChargingConfig", hook: useChargingConfig },
    { name: "useSolarConfig", hook: useSolarConfig },
    { name: "useBatteryConfig", hook: useBatteryConfig },
    { name: "useHomeConfig", hook: useHomeConfig },
    { name: "useEquipmentConfig", hook: useEquipmentConfig },
    { name: "useSystemConfig", hook: useSystemConfig },
    { name: "useNotificationConfig", hook: useNotificationConfig },
  ])("$name calls useQuery", ({ hook }) => {
    renderHook(() => hook(), { wrapper: createWrapper() });
    expect(mockUseQuery).toHaveBeenCalled();
  });
});

describe("config mutation hooks", () => {
  const createWrapper = () => {
    const qc = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
  };

  beforeEach(() => {
    mockUseMutation.mockClear();
    mockInvalidate.mockClear();
    capturedOptsRef.current = {};
  });

  const mutationHooks = [
    { name: "useChargingConfigMutation", hook: useChargingConfigMutation },
    { name: "useSolarConfigMutation", hook: useSolarConfigMutation },
    { name: "useBatteryConfigMutation", hook: useBatteryConfigMutation },
    { name: "useHomeConfigMutation", hook: useHomeConfigMutation },
    { name: "useEquipmentConfigMutation", hook: useEquipmentConfigMutation },
    { name: "useSystemConfigMutation", hook: useSystemConfigMutation },
    {
      name: "useNotificationConfigMutation",
      hook: useNotificationConfigMutation,
    },
  ];

  mutationHooks.forEach(({ name, hook }) => {
    describe(name, () => {
      it("returns saveStatus and mutation", () => {
        const { result } = renderHook(() => hook(), {
          wrapper: createWrapper(),
        });

        expect(result.current.saveStatus).toBeDefined();
        expect(result.current.saveStatus.state).toBe("idle");
      });

      it("onSuccess invalidates query and transitions to saved", () => {
        const { result } = renderHook(() => hook(), {
          wrapper: createWrapper(),
        });

        act(() => {
          capturedOptsRef.current.onSuccess?.();
        });

        expect(mockInvalidate).toHaveBeenCalled();
        expect(result.current.saveStatus.state).toBe("saved");
      });

      it("onError transitions to error state", () => {
        const { result } = renderHook(() => hook(), {
          wrapper: createWrapper(),
        });

        act(() => {
          capturedOptsRef.current.onError?.(new Error("Save failed"));
        });

        expect(result.current.saveStatus.state).toBe("error");
        expect(result.current.saveStatus.message).toBe("Save failed");
      });

      it("onMutate triggers saving delay", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => hook(), {
          wrapper: createWrapper(),
        });

        act(() => {
          capturedOptsRef.current.onMutate?.();
        });

        // Still idle before 300ms
        expect(result.current.saveStatus.state).toBe("idle");

        act(() => {
          vi.advanceTimersByTime(300);
        });

        expect(result.current.saveStatus.state).toBe("saving");
        vi.useRealTimers();
      });
    });
  });
});
