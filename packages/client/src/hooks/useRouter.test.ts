import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { pageFromPath, useRouter } from "./useRouter.ts";

describe("pageFromPath", () => {
  it.each([
    ["/", "dashboard"],
    ["/stats", "stats"],
    ["/schedules", "schedules"],
    ["/logs", "logs"],
    ["/settings", "settings"],
    ["/unknown", "dashboard"],
  ])("maps %s to %s", (path, page) => {
    expect(pageFromPath(path)).toBe(page);
  });
});

describe("useRouter", () => {
  beforeEach(() => {
    globalThis.history.pushState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[string, unknown]>([
    ["/", { type: "app", page: "dashboard" }],
    ["/stats", { type: "app", page: "stats" }],
    ["/wizard", { type: "wizard" }],
    ["/wizard/step-2", { type: "wizard" }],
    ["/setup/tesla", { type: "pluginSetup", pluginId: "tesla" }],
    [
      "/setup/fronius_local",
      { type: "pluginSetup", pluginId: "fronius_local" },
    ],
    ["/login", { type: "login" }],
    ["/unknown", { type: "app", page: "dashboard" }],
  ])("resolves %s", (path, expected) => {
    globalThis.history.pushState(null, "", path);
    const { result } = renderHook(() => useRouter());
    expect(result.current.route).toEqual(expected);
  });

  describe("navigate", () => {
    it.each<[
      Parameters<ReturnType<typeof useRouter>["navigate"]>[0],
      string,
    ]>([
      [{ type: "app", page: "settings" }, "/settings"],
      [{ type: "wizard" }, "/wizard"],
      [{ type: "pluginSetup", pluginId: "tesla" }, "/setup/tesla"],
      [{ type: "login" }, "/login"],
    ])("navigates and updates URL to %j", (target, path) => {
      const { result } = renderHook(() => useRouter());

      act(() => {
        result.current.navigate(target);
      });

      expect(result.current.route).toEqual(target);
      expect(globalThis.location.pathname).toBe(path);
    });
  });

  describe("popstate", () => {
    it("updates route on browser back/forward", async () => {
      const { result } = renderHook(() => useRouter());

      // Navigate forward
      act(() => {
        result.current.navigate({ type: "app", page: "stats" });
      });
      expect(result.current.route).toEqual({ type: "app", page: "stats" });

      // Simulate browser back
      globalThis.history.back();
      await waitFor(() => {
        expect(result.current.route).toEqual({
          type: "app",
          page: "dashboard",
        });
      });
    });
  });

  describe("navigate reference stability", () => {
    it("returns the same navigate function across re-renders", () => {
      const { result, rerender } = renderHook(() => useRouter());
      const firstNavigate = result.current.navigate;
      rerender();
      expect(result.current.navigate).toBe(firstNavigate);
    });
  });
});
