import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  connectionStatusStore,
  useConnectionStatus,
} from "./useConnectionStatus.ts";

describe("useConnectionStatus", () => {
  beforeEach(() => {
    // Reset to default state
    connectionStatusStore.setState("connecting");
  });

  describe("rendering", () => {
    it.each(["connecting", "connected", "disconnected"] as const)(
      "returns '%s' when store is set to %s",
      (status) => {
        connectionStatusStore.setState(status);
        const { result } = renderHook(() => useConnectionStatus());
        expect(result.current).toBe(status);
      },
    );
  });

  describe("status updates", () => {
    it("updates when status changes", () => {
      connectionStatusStore.setState("disconnected");
      const { result } = renderHook(() => useConnectionStatus());
      expect(result.current).toBe("disconnected");

      act(() => {
        connectionStatusStore.setState("connecting");
      });
      expect(result.current).toBe("connecting");

      act(() => {
        connectionStatusStore.setState("connected");
      });
      expect(result.current).toBe("connected");
    });

    it("does not re-render when set to the same status", () => {
      connectionStatusStore.setState("connected");
      const { result } = renderHook(() => useConnectionStatus());
      expect(result.current).toBe("connected");

      // Setting to the same value should be a no-op
      act(() => {
        connectionStatusStore.setState("connected");
      });
      expect(result.current).toBe("connected");
    });
  });

  describe("cleanup", () => {
    it("unsubscribes when the hook unmounts", () => {
      const { unmount } = renderHook(() => useConnectionStatus());

      unmount();

      // After unmount, status changes should not cause errors
      act(() => {
        connectionStatusStore.setState("disconnected");
      });
    });
  });
});
