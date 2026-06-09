import { afterEach, describe, expect, it, vi } from "vitest";
import { demoMode, Feature } from "./featureFlags.ts";

describe("demoMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("allows", () => {
    it("enables all features outside demo mode", () => {
      vi.stubEnv("VITE_DEMO_MODE", "");
      expect(demoMode.allows(Feature.OidcAuth)).toBe(true);
    });

    it("disables demo-disabled features in demo mode", () => {
      vi.stubEnv("VITE_DEMO_MODE", "1");
      expect(demoMode.allows(Feature.OidcAuth)).toBe(false);
    });
  });

  describe("blockedPlugins", () => {
    const opts = [{ id: "sim", demoAvailable: true }, { id: "fronius" }];

    it("blocks nothing outside demo mode", () => {
      vi.stubEnv("VITE_DEMO_MODE", "");
      expect(demoMode.blockedPlugins(opts).size).toBe(0);
    });

    it("blocks non-demo-available plugins in demo mode", () => {
      vi.stubEnv("VITE_DEMO_MODE", "1");
      expect([...demoMode.blockedPlugins(opts)]).toEqual(["fronius"]);
    });
  });
});
