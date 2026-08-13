import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { CallContext } from "@chargeha/shared";
import { UnconfiguredChargerMiddleware } from "./UnconfiguredChargerMiddleware.ts";

describe("UnconfiguredChargerMiddleware", () => {
  const ctx: CallContext = { origin: "test", traceId: "test-trace" };
  const build = () =>
    new UnconfiguredChargerMiddleware(
      "charger-1",
      "Tapo host not configured",
    );

  describe("state", () => {
    it("reports the reason it could not start as the status detail", async () => {
      const state = await build().requestState(ctx);

      expect(state?.status).toBe("unconfigured");
      expect(state?.statusDetail).toBe("Tapo host not configured");
      expect(state?.chargerId).toBe("charger-1");
    });

    it("claims nothing about a device it never reached", async () => {
      const state = await build().requestState(ctx);

      expect(state?.isCharging).toBe(false);
      expect(state?.chargeAmps).toBeNull();
      expect(state?.chargePowerKw).toBeNull();
      expect(state?.isPluggedIn).toBeNull();
    });

    it("serves the same state from cache, with a fixed timestamp", async () => {
      const middleware = build();

      const requested = await middleware.requestState(ctx);
      const cached = middleware.getCachedState();

      expect(cached).toEqual(requested);
      // A moving timestamp would re-emit charger_update on every poll.
      expect(cached?.lastUpdated).toBe(requested?.lastUpdated);
    });
  });

  describe("commands", () => {
    it("refuses every command rather than pretending to act", async () => {
      const middleware = build();

      expect(await middleware.startCharging(ctx)).toBe(false);
      expect(await middleware.stopCharging(ctx)).toBe(false);
      expect(await middleware.setChargeAmps(16, ctx)).toBe(false);
    });

    it("reports switch control mode — it commands nothing either way", () => {
      expect(build().getCachedState()?.controlMode).toBe("switch");
    });
  });
});
