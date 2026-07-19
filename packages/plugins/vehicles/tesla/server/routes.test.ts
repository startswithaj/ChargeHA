import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "@chargeha/server/db";
import { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { VehicleManager } from "@chargeha/server/services/VehicleManager";
import type { EnergyAdapterManager } from "../../../../server/src/services/EnergyAdapterManager.ts";
import { throwingMock } from "../../../../server/src/test-helpers/throwingMock.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import { TeslaTokenManager } from "./TeslaTokenManager.ts";
import { createTeslaHttpRoutes } from "./routes.ts";

describe("Tesla HTTP routes", () => {
  const testLogger = new Logger("Tesla", "error");

  let db: AppDatabase;
  let deps: PluginDependencies;

  const makeDeps = (appDb: AppDatabase): PluginDependencies =>
    PluginDependencies.create({
      db: appDb,
      vehicleManager: throwingMock<VehicleManager>("VehicleManager"),
      energyManager: throwingMock<EnergyAdapterManager>("EnergyAdapterManager"),
      tunnel: {
        getUrl: () => null,
        start: () => Promise.reject(new Error("tunnel not mocked")),
        stop: () => Promise.resolve(),
        getExpiryMinutes: () => null,
      },
      geocode: () => Promise.reject(new Error("geocode not mocked")),
      encryptionConfigured: () => false,
      pluginId: "tesla",
    });

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    await db.setPluginConfig("tesla.client_id", "test-client-id");
    await db.setPluginConfig("tesla.client_secret", "test-client-secret");
    await db.setPluginConfig("tesla.region", "na");
    deps = makeDeps(db);
  });

  afterEach(() => {
    db.close();
  });

  const okTokenFetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

  describe("GET /callback", () => {
    it("rejects a callback with no state", async () => {
      const manager = new TeslaTokenManager(deps, testLogger, okTokenFetch);
      const app = createTeslaHttpRoutes(manager, deps);
      try {
        const res = await app.request("/callback?code=abc");
        expect(res.status).toBe(400);
      } finally {
        manager.stopAutoRefresh();
      }
    });

    it("rejects a state this server never issued", async () => {
      let exchanged = false;
      const manager = new TeslaTokenManager(deps, testLogger, () => {
        exchanged = true;
        return okTokenFetch();
      });
      const app = createTeslaHttpRoutes(manager, deps);
      try {
        const res = await app.request("/callback?code=abc&state=not-ours");
        expect(res.status).toBe(400);
        // The point of the check: no token exchange happens for a handshake
        // this server never started.
        expect(exchanged).toBe(false);
      } finally {
        manager.stopAutoRefresh();
      }
    });

    it("exchanges the code for a state issued by this server", async () => {
      let capturedBody: string | undefined;
      const manager = new TeslaTokenManager(
        deps,
        testLogger,
        (_input, init) => {
          capturedBody = init?.body as string;
          return okTokenFetch();
        },
      );
      const app = createTeslaHttpRoutes(manager, deps);
      try {
        await manager.getAuthorizationUrl("state-1", "https://tunnel.example");
        const res = await app.request("/callback?code=abc&state=state-1");
        expect(res.status).toBe(200);
        const params = new URLSearchParams(capturedBody);
        // The recorded origin, not the request URL, drives redirect_uri.
        expect(params.get("redirect_uri")).toBe(
          "https://tunnel.example/api/vehicle/tesla/callback",
        );
        expect(await db.getPluginConfig("tesla.access_token")).toBe(
          "new-access",
        );
      } finally {
        manager.stopAutoRefresh();
      }
    });

    it("consumes the state so a replayed callback is rejected", async () => {
      const manager = new TeslaTokenManager(deps, testLogger, okTokenFetch);
      const app = createTeslaHttpRoutes(manager, deps);
      try {
        await manager.getAuthorizationUrl("state-1", "https://tunnel.example");
        expect((await app.request("/callback?code=a&state=state-1")).status)
          .toBe(200);
        expect((await app.request("/callback?code=a&state=state-1")).status)
          .toBe(400);
      } finally {
        manager.stopAutoRefresh();
      }
    });

    it("escapes the upstream error body in the failure page", async () => {
      const manager = new TeslaTokenManager(
        deps,
        testLogger,
        () =>
          Promise.resolve(
            new Response("<script>alert(1)</script>", { status: 400 }),
          ),
      );
      const app = createTeslaHttpRoutes(manager, deps);
      try {
        await manager.getAuthorizationUrl("state-1", "https://tunnel.example");
        const res = await app.request("/callback?code=abc&state=state-1");
        expect(res.status).toBe(500);
        const body = await res.text();
        expect(body).toContain("&lt;script&gt;");
        expect(body).not.toContain("<script>alert(1)</script>");
      } finally {
        manager.stopAutoRefresh();
      }
    });
  });

  describe("GET /com.tesla.3p.public-key.pem", () => {
    it("404s when no key is stored", async () => {
      const manager = new TeslaTokenManager(deps, testLogger, okTokenFetch);
      const app = createTeslaHttpRoutes(manager, deps);
      try {
        const res = await app.request("/com.tesla.3p.public-key.pem");
        expect(res.status).toBe(404);
      } finally {
        manager.stopAutoRefresh();
      }
    });

    it("serves the stored public key", async () => {
      await db.setPluginConfig("tesla.ec_public_key_pem", "PEM-BODY");
      const manager = new TeslaTokenManager(deps, testLogger, okTokenFetch);
      const app = createTeslaHttpRoutes(manager, deps);
      try {
        const res = await app.request("/com.tesla.3p.public-key.pem");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("PEM-BODY");
      } finally {
        manager.stopAutoRefresh();
      }
    });
  });
});
