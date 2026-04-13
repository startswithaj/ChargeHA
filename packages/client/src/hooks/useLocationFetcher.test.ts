import { assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    vehicle: {
      refreshState: {
        useMutation: () => ({ mutateAsync: mocks.mutateAsync }),
      },
    },
  },
}));

import { useLocationFetcher } from "./useLocationFetcher.ts";

describe("useLocationFetcher", () => {
  const createWrapper = () => {
    const qc = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
  };

  const setup = () =>
    renderHook(() => useLocationFetcher(), { wrapper: createWrapper() });

  type GetCurrentPosition = (
    success: PositionCallback,
    error?: PositionErrorCallback,
  ) => void;

  let originalGeolocation: typeof navigator.geolocation | undefined;

  const setGeolocation = (value: unknown) => {
    Object.defineProperty(navigator, "geolocation", {
      value,
      writable: true,
      configurable: true,
    });
  };

  const withGeolocation = (getCurrentPosition: GetCurrentPosition) => {
    const mockFn = vi.fn(getCurrentPosition);
    setGeolocation({ getCurrentPosition: mockFn });
    return mockFn;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.mutateAsync.mockReset();
    originalGeolocation = navigator.geolocation;
  });

  afterEach(() => {
    vi.useRealTimers();
    setGeolocation(originalGeolocation);
  });

  it("returns initial idle state", () => {
    const { result } = setup();

    expect(result.current.geoStatus).toBe("idle");
    expect(result.current.geoError).toBe("");
    expect(result.current.geoLoadingMsg).toBe("");
  });

  describe("handleVehicleLocation", () => {
    it("sets loading state and calls fetch", async () => {
      mocks.mutateAsync.mockReturnValue(
        Promise.resolve({
          state: { latitude: -37.814, longitude: 144.963 },
        }),
      );

      const { result } = setup();

      const onCoords = vi.fn();

      await act(async () => {
        result.current.handleVehicleLocation("VIN1", onCoords);
        await vi.runAllTimersAsync();
      });

      expect(onCoords).toHaveBeenCalledWith("-37.814000", "144.963000");
      expect(result.current.geoStatus).toBe("idle");
      expect(result.current.geoLoadingMsg).toBe("");
    });

    it("handles fetch error with Error instance", async () => {
      mocks.mutateAsync.mockRejectedValue(new Error("Vehicle offline"));

      const { result } = setup();

      const onCoords = vi.fn();

      await act(async () => {
        result.current.handleVehicleLocation("VIN1", onCoords);
        await vi.runAllTimersAsync();
      });

      expect(onCoords).not.toHaveBeenCalled();
      expect(result.current.geoStatus).toBe("error");
      expect(result.current.geoError).toBe("Vehicle offline");
      expect(result.current.geoLoadingMsg).toBe("");
    });

    it("handles fetch error with non-Error value", async () => {
      mocks.mutateAsync.mockRejectedValue("unknown failure");

      const { result } = setup();

      const onCoords = vi.fn();

      await act(async () => {
        result.current.handleVehicleLocation("VIN1", onCoords);
        await vi.runAllTimersAsync();
      });

      expect(result.current.geoError).toBe("Failed to get vehicle location");
    });

    it("shows wake message after 3 seconds", async () => {
      let resolveFetch = null as
        | ((val: {
          state: { latitude: number; longitude: number };
        }) => void)
        | null;
      mocks.mutateAsync.mockReturnValue(
        new Promise((r) => {
          resolveFetch = r;
        }),
      );

      const { result } = setup();

      const onCoords = vi.fn();

      await act(() => {
        result.current.handleVehicleLocation("VIN1", onCoords);
      });

      expect(result.current.geoLoadingMsg).toBe("Fetching vehicle location...");

      await act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.geoLoadingMsg).toContain("Vehicle is asleep");

      await act(async () => {
        assertExists(resolveFetch);
        resolveFetch({ state: { latitude: -37.814, longitude: 144.963 } });
        await vi.runAllTimersAsync();
      });

      expect(result.current.geoLoadingMsg).toBe("");
    });
  });

  describe("handleBrowserLocation", () => {
    it("errors when geolocation is not supported", () => {
      setGeolocation(undefined);

      const { result } = setup();

      const onCoords = vi.fn();

      act(() => {
        result.current.handleBrowserLocation(onCoords);
      });

      expect(result.current.geoStatus).toBe("error");
      expect(result.current.geoError).toBe(
        "Your browser does not support geolocation",
      );
      expect(onCoords).not.toHaveBeenCalled();
    });

    it("calls onCoords on success", () => {
      withGeolocation((success: PositionCallback) => {
        success({
          coords: { latitude: -33.8688, longitude: 151.2093 },
        } as GeolocationPosition);
      });

      const { result } = setup();

      const onCoords = vi.fn();

      act(() => {
        result.current.handleBrowserLocation(onCoords);
      });

      expect(onCoords).toHaveBeenCalledWith("-33.868800", "151.209300");
      expect(result.current.geoStatus).toBe("idle");
      expect(result.current.geoLoadingMsg).toBe("");
    });

    it.each([
      { code: 1, contains: "permission denied", equals: undefined },
      { code: 2, contains: "Could not determine", equals: undefined },
      { code: 3, contains: "timed out", equals: undefined },
      {
        code: 99,
        contains: undefined,
        equals: "Failed to get location",
      },
    ])(
      "handles geolocation error code $code",
      ({ code, contains, equals }) => {
        withGeolocation((_success, error) => {
          assertExists(error);
          error({ code } as GeolocationPositionError);
        });

        const { result } = setup();

        act(() => {
          result.current.handleBrowserLocation(vi.fn());
        });

        expect(result.current.geoStatus).toBe("error");
        if (contains !== undefined) {
          expect(result.current.geoError).toContain(contains);
        }
        if (equals !== undefined) {
          expect(result.current.geoError).toBe(equals);
          expect(result.current.geoLoadingMsg).toBe("");
        }
      },
    );

    it("sets loading state before geolocation call", () => {
      withGeolocation(() => {});

      const { result } = setup();

      act(() => {
        result.current.handleBrowserLocation(vi.fn());
      });

      expect(result.current.geoStatus).toBe("loading");
      expect(result.current.geoLoadingMsg).toBe("Getting your location...");
    });
  });
});
