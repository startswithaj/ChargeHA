import { assertExists } from "@std/assert";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createTestQueryClient } from "../test-utils.tsx";

const hoisted = vi.hoisted(() => ({
  setStatus: vi.fn(),
  captured: {
    onData: undefined as
      | ((event: Record<string, unknown>) => void)
      | undefined,
    onError: undefined as (() => void) | undefined,
  },
}));

vi.mock("./useConnectionStatus.ts", () => ({
  connectionStatusStore: {
    setState: (...args: unknown[]) => hoisted.setStatus(...args),
  },
}));

vi.mock("../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    subscription: {
      onEvents: {
        useSubscription: (
          _input: unknown,
          opts: {
            onData: (event: Record<string, unknown>) => void;
            onError: () => void;
          },
        ) => {
          hoisted.captured.onData = opts.onData;
          hoisted.captured.onError = opts.onError;
        },
      },
    },
  },
}));

import { useRealtimeEvents } from "./useRealtimeEvents.ts";

describe("useRealtimeEvents", () => {
  const createWrapper = () => {
    const qc = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
  };

  const makeHandlers = () => ({
    onEnergyUpdate: vi.fn(),
    onVehicleUpdate: vi.fn(),
    onVehicleError: vi.fn(),
    onControllerStatus: vi.fn(),
  });

  const setup = (handlers = makeHandlers()) => {
    renderHook(() => useRealtimeEvents(handlers), { wrapper: createWrapper() });
    return handlers;
  };

  beforeEach(() => {
    hoisted.setStatus.mockClear();
    hoisted.captured.onData = undefined;
    hoisted.captured.onError = undefined;
  });

  it.each([
    {
      type: "energy_update",
      handlerKey: "onEnergyUpdate" as const,
      data: { solarW: 5000, gridW: 1000 },
    },
    {
      type: "vehicle_update",
      handlerKey: "onVehicleUpdate" as const,
      data: { vehicleId: "VIN1", batteryLevel: 80 },
    },
    {
      type: "vehicle_error",
      handlerKey: "onVehicleError" as const,
      data: { vehicleId: "VIN1", vehicleName: "Tesla", error: "API timeout" },
    },
  ])("routes $type events to $handlerKey", ({ type, handlerKey, data }) => {
    const handlers = setup();

    assertExists(hoisted.captured.onData);
    hoisted.captured.onData({ type, data });

    expect(handlers[handlerKey]).toHaveBeenCalledWith(data);
    (Object.keys(handlers) as (keyof typeof handlers)[])
      .filter((k) => k !== handlerKey)
      .forEach((k) => expect(handlers[k]).not.toHaveBeenCalled());
  });

  it("sets connection status to connected on data event", () => {
    setup();

    assertExists(hoisted.captured.onData);
    hoisted.captured.onData({ type: "energy_update", data: {} });

    expect(hoisted.setStatus).toHaveBeenCalledWith("connected");
  });

  it("sets connection status to disconnected on error", () => {
    setup();

    assertExists(hoisted.captured.onError);
    hoisted.captured.onError();

    expect(hoisted.setStatus).toHaveBeenCalledWith("disconnected");
  });

  it("uses latest handler refs (handlers can change without re-subscribing)", () => {
    const handlers1 = makeHandlers();

    const { rerender } = renderHook(
      (props: { handlers: typeof handlers1 }) =>
        useRealtimeEvents(props.handlers),
      {
        wrapper: createWrapper(),
        initialProps: { handlers: handlers1 },
      },
    );

    const handlers2 = makeHandlers();
    rerender({ handlers: handlers2 });

    assertExists(hoisted.captured.onData);
    hoisted.captured.onData({ type: "energy_update", data: { solarW: 1000 } });

    expect(handlers1.onEnergyUpdate).not.toHaveBeenCalled();
    expect(handlers2.onEnergyUpdate).toHaveBeenCalledWith({ solarW: 1000 });
  });
});
