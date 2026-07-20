import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { AppDatabase } from "@chargeha/server/db";
import { TeslaTokenManager } from "./TeslaTokenManager.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { VehicleManager } from "@chargeha/server/services/VehicleManager";
import type { EnergyAdapterManager } from "../../../../server/src/services/EnergyAdapterManager.ts";
import { throwingMock } from "../../../../server/src/test-helpers/throwingMock.ts";

describe("TeslaTokenManager", () => {
  const testLogger = new Logger("Tesla", "error");

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

  /** Seed tokens directly into the DB using namespaced config keys. */
  const seedTokens = async (
    db: AppDatabase,
    access: string,
    refresh: string,
    expiresAt: string,
  ) => {
    await db.setPluginConfig("tesla.access_token", access);
    await db.setPluginConfig("tesla.refresh_token", refresh);
    await db.setPluginConfig("tesla.token_expires_at", expiresAt);
  };

  let db: AppDatabase;
  let deps: PluginDependencies;
  let manager: TeslaTokenManager;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    // Seed default credentials for most tests
    await db.setPluginConfig("tesla.client_id", "test-client-id");
    await db.setPluginConfig("tesla.client_secret", "test-client-secret");
    await db.setPluginConfig("tesla.region", "na");
    deps = PluginDependencies.create({
      db,
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
    manager = new TeslaTokenManager(deps, testLogger);
  });

  afterEach(() => {
    manager.stopAutoRefresh();
    db.close();
  });

  describe("getAuthorizationUrl", () => {
    it("returns a valid Tesla OAuth URL with request origin", async () => {
      const url = await manager.getAuthorizationUrl(
        "test-state",
        "https://chargeha.example.com",
      );
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://auth.tesla.com");
      expect(parsed.pathname).toBe("/oauth2/v3/authorize");
      expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("state")).toBe("test-state");
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        "https://chargeha.example.com/api/vehicle/tesla/callback",
      );
    });

    it("includes required scopes", async () => {
      const url = await manager.getAuthorizationUrl(
        "state",
        "https://chargeha.example.com",
      );
      const parsed = new URL(url);
      const scope = parsed.searchParams.get("scope");
      assertExists(scope);

      expect(scope).toContain("openid");
      expect(scope).toContain("offline_access");
      expect(scope).toContain("vehicle_device_data");
      expect(scope).toContain("vehicle_charging_cmds");
    });

    it("records the origin per state for the callback, consumed on read", async () => {
      await manager.getAuthorizationUrl(
        "state-1",
        "https://chargeha.example.com",
      );

      expect(manager.takeAuthOrigin("state-1")).toBe(
        "https://chargeha.example.com",
      );
      // Consumed — a second read (or an unknown state) yields null.
      expect(manager.takeAuthOrigin("state-1")).toBeNull();
      expect(manager.takeAuthOrigin("unknown-state")).toBeNull();
    });
  });

  describe("isAuthenticated", () => {
    it("returns false when no tokens exist", async () => {
      expect(await manager.isAuthenticated()).toBe(false);
    });

    it("returns true when valid tokens exist", async () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await seedTokens(db, "access", "refresh", expiresAt);

      expect(await manager.isAuthenticated()).toBe(true);
    });

    it("returns false when tokens are expired", async () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString();
      await seedTokens(db, "access", "refresh", expiresAt);

      // Inject a fetch that returns 401 immediately so the refresh attempt
      // fails fast instead of hitting Tesla's real OAuth endpoint.
      const failingFetch = () =>
        Promise.resolve(new Response("unauthorized", { status: 401 }));
      const m = new TeslaTokenManager(deps, testLogger, failingFetch);
      try {
        expect(await m.isAuthenticated()).toBe(false);
      } finally {
        m.stopAutoRefresh();
      }
    });
  });

  describe("getStatus", () => {
    it("returns unauthenticated status when no tokens", async () => {
      const status = await manager.getStatus();
      expect(status.authenticated).toBe(false);
      expect(status.vehicleConfigured).toBe(false);
      expect(status.vin).toBeNull();
      expect(status.vehicleName).toBeNull();
    });

    it("returns authenticated status with vehicle when configured", async () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await seedTokens(db, "access", "refresh", expiresAt);
      await db.upsertVehicle({
        id: "VIN123",
        name: "My Model 3",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });

      const status = await manager.getStatus();
      expect(status.authenticated).toBe(true);
      expect(status.vehicleConfigured).toBe(true);
      expect(status.vin).toBe("VIN123");
      expect(status.vehicleName).toBe("My Model 3");
    });
  });

  describe("getAccessToken", () => {
    it("throws when no tokens exist", async () => {
      await expect(manager.getAccessToken()).rejects.toThrow(
        "No tokens available",
      );
    });

    it("returns access token when not expired", async () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await seedTokens(db, "valid-access-token", "refresh", expiresAt);

      const token = await manager.getAccessToken();
      expect(token).toBe("valid-access-token");
    });
  });

  describe("getFleetApiBaseUrl", () => {
    ([
      ["na", "https://fleet-api.prd.na.vn.cloud.tesla.com"],
      ["eu", "https://fleet-api.prd.eu.vn.cloud.tesla.com"],
    ] as const).forEach(([region, expected]) => {
      it(`returns ${region} fleet API URL`, async () => {
        await db.setPluginConfig("tesla.region", region);
        const d = makeDeps(db);
        const m = new TeslaTokenManager(d, testLogger);
        try {
          expect(await m.getFleetApiBaseUrl()).toBe(expected);
        } finally {
          m.stopAutoRefresh();
        }
      });
    });
  });

  describe("reads credentials fresh from DB", () => {
    it("reads credentials from DB on every call", async () => {
      await db.setPluginConfig("tesla.client_id", "db-client-id");
      await db.setPluginConfig("tesla.client_secret", "db-secret");
      await db.setPluginConfig("tesla.region", "eu");

      const d = makeDeps(db);
      const m = new TeslaTokenManager(d, testLogger);

      try {
        const url = await m.getAuthorizationUrl(
          "state",
          "https://chargeha.local",
        );
        const parsed = new URL(url);
        expect(parsed.searchParams.get("client_id")).toBe("db-client-id");
        expect(parsed.searchParams.get("redirect_uri")).toBe(
          "https://chargeha.local/api/vehicle/tesla/callback",
        );
        expect(await m.getFleetApiBaseUrl()).toBe(
          "https://fleet-api.prd.eu.vn.cloud.tesla.com",
        );
      } finally {
        m.stopAutoRefresh();
      }
    });

    it("picks up updated credentials without restart", async () => {
      await db.setPluginConfig("tesla.client_id", "old-id");
      await db.setPluginConfig("tesla.client_secret", "old-secret");
      await db.setPluginConfig("tesla.region", "na");

      const d = makeDeps(db);
      const m = new TeslaTokenManager(d, testLogger);
      try {
        const url1 = await m.getAuthorizationUrl("s", "https://x.com");
        expect(
          new URL(url1).searchParams.get("client_id"),
        ).toBe("old-id");

        // Update DB config — no reinitialize needed
        await db.setPluginConfig("tesla.client_id", "new-id");
        await db.setPluginConfig("tesla.region", "eu");

        const url2 = await m.getAuthorizationUrl("s", "https://x.com");
        const parsed = new URL(url2);
        expect(parsed.searchParams.get("client_id")).toBe("new-id");
        expect(await m.getFleetApiBaseUrl()).toBe(
          "https://fleet-api.prd.eu.vn.cloud.tesla.com",
        );
      } finally {
        m.stopAutoRefresh();
      }
    });

    it("callback handler uses request origin for redirect_uri", async () => {
      await db.setPluginConfig("tesla.client_id", "cb-client-id");
      await db.setPluginConfig("tesla.client_secret", "cb-secret");

      const d = makeDeps(db);
      let capturedBody: string | undefined;
      const fakeFetch = (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        capturedBody = init?.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "new-access",
              refresh_token: "new-refresh",
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        );
      };
      const m = new TeslaTokenManager(d, testLogger, fakeFetch);

      try {
        await m.handleCallback("test-code", "https://cb.example.com");
        assertExists(capturedBody);
        const params = new URLSearchParams(capturedBody);
        expect(params.get("client_id")).toBe("cb-client-id");
        expect(params.get("client_secret")).toBe("cb-secret");
        expect(params.get("redirect_uri")).toBe(
          "https://cb.example.com/api/vehicle/tesla/callback",
        );
      } finally {
        m.stopAutoRefresh();
      }
    });

    it("shares one refresh request across concurrent callers", async () => {
      const d = makeDeps(db);
      // Expired access token, so every entry point below triggers a refresh.
      const expiredAt = new Date(Date.now() - 1000).toISOString();
      await seedTokens(db, "old-access", "old-refresh", expiredAt);

      let calls = 0;
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fakeFetch = async () => {
        calls++;
        // Hold the request open so the second caller arrives mid-flight.
        await gate;
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      };
      const m = new TeslaTokenManager(d, testLogger, fakeFetch);

      try {
        const both = Promise.all([m.getAccessToken(), m.isAuthenticated()]);
        release();
        const [token] = await both;
        expect(calls).toBe(1);
        expect(token).toBe("new-access");
      } finally {
        m.stopAutoRefresh();
      }
    });

    it("returns empty strings when no credentials in DB", async () => {
      // Fresh DB with no tesla config
      const freshDb = new AppDatabase(":memory:");
      await freshDb.init();
      const freshDeps = makeDeps(freshDb);
      const m = new TeslaTokenManager(freshDeps, testLogger);

      const url = await m.getAuthorizationUrl("s", "https://chargeha.local");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("client_id")).toBe("");
      m.stopAutoRefresh();
      freshDb.close();
    });

    it("token access still works after credentials change", async () => {
      await db.setPluginConfig("tesla.client_id", "refresh-client-id");
      await db.setPluginConfig("tesla.client_secret", "refresh-secret");

      const d = makeDeps(db);
      const m = new TeslaTokenManager(d, testLogger);

      // Store tokens
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await seedTokens(db, "access-token", "refresh-token", expiresAt);

      const token = await m.getAccessToken();
      expect(token).toBe("access-token");

      // Update credentials — tokens should still be accessible
      await db.setPluginConfig("tesla.client_id", "updated-client-id");

      const token2 = await m.getAccessToken();
      expect(token2).toBe("access-token");
      m.stopAutoRefresh();
    });
  });
});
