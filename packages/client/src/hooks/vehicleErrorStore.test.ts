import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVehicleErrors, vehicleErrorStore } from "./vehicleErrorStore.ts";

describe("vehicleErrorStore", () => {
  beforeEach(() => {
    // Clear all errors between tests by clearing each known vehicle
    const snapshot = vehicleErrorStore.getSnapshot();
    Object.keys(snapshot).forEach((key) => {
      vehicleErrorStore.clearError(key);
    });
  });

  describe("setError", () => {
    it("adds an error for a vehicle", () => {
      vehicleErrorStore.setError("VIN1", "Connection timeout");
      expect(vehicleErrorStore.getSnapshot()).toEqual({
        VIN1: "Connection timeout",
      });
    });

    it("overwrites an existing error for the same vehicle", () => {
      vehicleErrorStore.setError("VIN1", "First error");
      vehicleErrorStore.setError("VIN1", "Second error");
      expect(vehicleErrorStore.getSnapshot()).toEqual({
        VIN1: "Second error",
      });
    });

    it("tracks errors for multiple vehicles", () => {
      vehicleErrorStore.setError("VIN1", "Error A");
      vehicleErrorStore.setError("VIN2", "Error B");
      expect(vehicleErrorStore.getSnapshot()).toEqual({
        VIN1: "Error A",
        VIN2: "Error B",
      });
    });

    it("notifies all listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsub1 = vehicleErrorStore.subscribe(listener1);
      const unsub2 = vehicleErrorStore.subscribe(listener2);

      vehicleErrorStore.setError("VIN1", "err");

      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();

      unsub1();
      unsub2();
    });

    it("creates a new object reference on each set (immutable update)", () => {
      vehicleErrorStore.setError("VIN1", "err1");
      const snap1 = vehicleErrorStore.getSnapshot();
      vehicleErrorStore.setError("VIN2", "err2");
      const snap2 = vehicleErrorStore.getSnapshot();
      expect(snap1).not.toBe(snap2);
    });
  });

  describe("clearError", () => {
    it("removes an existing error", () => {
      vehicleErrorStore.setError("VIN1", "err");
      vehicleErrorStore.clearError("VIN1");
      expect(vehicleErrorStore.getSnapshot()).toEqual({});
    });

    it("does not notify if vehicleId has no error (early return)", () => {
      const listener = vi.fn();
      const unsub = vehicleErrorStore.subscribe(listener);
      listener.mockClear();

      vehicleErrorStore.clearError("nonexistent");
      expect(listener).not.toHaveBeenCalled();

      unsub();
    });

    it("notifies listeners when an error is actually cleared", () => {
      vehicleErrorStore.setError("VIN1", "err");
      const listener = vi.fn();
      const unsub = vehicleErrorStore.subscribe(listener);
      listener.mockClear();

      vehicleErrorStore.clearError("VIN1");
      expect(listener).toHaveBeenCalledOnce();

      unsub();
    });

    it("only removes the specified vehicle, leaving others", () => {
      vehicleErrorStore.setError("VIN1", "err1");
      vehicleErrorStore.setError("VIN2", "err2");
      vehicleErrorStore.clearError("VIN1");
      expect(vehicleErrorStore.getSnapshot()).toEqual({ VIN2: "err2" });
    });
  });

  describe("subscribe", () => {
    it("returns an unsubscribe function", () => {
      const listener = vi.fn();
      const unsub = vehicleErrorStore.subscribe(listener);
      expect(typeof unsub).toBe("function");
      unsub();
    });

    it("unsubscribed listener is not called", () => {
      const listener = vi.fn();
      const unsub = vehicleErrorStore.subscribe(listener);
      unsub();
      listener.mockClear();

      vehicleErrorStore.setError("VIN1", "err");
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("getSnapshot", () => {
    it("returns empty object initially", () => {
      expect(vehicleErrorStore.getSnapshot()).toEqual({});
    });
  });
});

describe("useVehicleErrors", () => {
  beforeEach(() => {
    const snapshot = vehicleErrorStore.getSnapshot();
    Object.keys(snapshot).forEach((key) => {
      vehicleErrorStore.clearError(key);
    });
  });

  it("returns current errors via useSyncExternalStore", () => {
    vehicleErrorStore.setError("VIN1", "test error");
    const { result } = renderHook(() => useVehicleErrors());
    expect(result.current).toEqual({ VIN1: "test error" });
  });

  it("returns empty object when no errors", () => {
    const { result } = renderHook(() => useVehicleErrors());
    expect(result.current).toEqual({});
  });
});
