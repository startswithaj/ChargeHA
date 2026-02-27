import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type React from "react";

import { ToastProvider, useToast } from "./useToast.tsx";

describe("useToast", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ToastProvider>{children}</ToastProvider>
  );

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when used outside ToastProvider", () => {
    // Suppress console.error for the expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useToast());
    }).toThrow("useToast must be used within a ToastProvider");

    spy.mockRestore();
  });

  it("addToast adds toast to the list", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.addToast("Something went wrong", "error");
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Something went wrong");
    expect(result.current.toasts[0].type).toBe("error");
  });

  it("removeToast removes toast", () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.addToast("Toast message", "info");
    });

    const toastId = result.current.toasts[0].id;

    act(() => {
      result.current.removeToast(toastId);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it.each<{ type: "error" | "success" | "info"; ms: number }>([
    { type: "error", ms: 6000 },
    { type: "success", ms: 3000 },
    { type: "info", ms: 4000 },
  ])(
    "auto-dismisses $type toast after $ms ms",
    ({ type, ms }) => {
      const { result } = renderHook(() => useToast(), { wrapper });

      act(() => {
        result.current.addToast(`${type} toast`, type);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(ms - 1);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(result.current.toasts).toHaveLength(0);
    },
  );
});
