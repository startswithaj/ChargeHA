import { describe, expect, it } from "vitest";
import { Feature, featureEnabledIn } from "./featureFlags.ts";

describe("featureFlags", () => {
  describe("featureEnabledIn", () => {
    it("enables all features when not in demo mode", () => {
      expect(featureEnabledIn(false, Feature.OidcAuth)).toBe(true);
    });

    it("disables demo-disabled features in demo mode", () => {
      expect(featureEnabledIn(true, Feature.OidcAuth)).toBe(false);
    });
  });
});
