import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { AppDatabase } from "@chargeha/server/db";
import { createAppRouter } from "../../../../server/src/trpc/root.ts";
import { createCallerFactory } from "../../../../server/src/trpc/trpc.ts";
import type { TrpcContext } from "../../../../server/src/trpc/trpc.ts";
import { VehicleManager } from "@chargeha/server/services/VehicleManager";
import { TypedEventEmitter } from "../../../../server/src/services/TypedEventEmitter.ts";
import { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyAdapterManager } from "../../../../server/src/services/EnergyAdapterManager.ts";
import { throwingMock } from "../../../../server/src/test-helpers/throwingMock.ts";
import type { TeslaServiceIo } from "./TeslaService.ts";
import { Logger } from "@chargeha/server/lib/Logger";
import { decrypt } from "@chargeha/server/lib/Encryption";
import { createTeslaRouter } from "./router.ts";
import { TeslaVehiclePlugin } from "./index.ts";
import { StubTeslaProxyManager } from "./test-helpers/StubTeslaProxyManager.ts";

describe("Tesla Plugin Router", () => {
  const testLogger = new Logger("Test", "error");

  function extractFetchUrl(input: string | URL | Request): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  /** Seed tokens directly into the DB using namespaced config keys. */
  async function seedTokens(
    db: AppDatabase,
    access: string,
    refresh: string,
    expiresAt: string,
  ) {
    await db.setPluginConfig("tesla.access_token", access);
    await db.setPluginConfig("tesla.refresh_token", refresh);
    await db.setPluginConfig("tesla.token_expires_at", expiresAt);
  }

  const TEST_ENCRYPTION_KEY = btoa(
    String.fromCharCode(
      ...new Uint8Array(32).map((_, i) => i),
    ),
  );

  /**
   * Build a full test context: real DB, registries, VehicleManager, and a
   * registered TeslaVehiclePlugin. Returns a tRPC caller (fully typed — the
   * router is built from the plugin instance) and the pieces tests need to
   * inspect. Tests that need to mock Fleet API calls pass in a `serviceIo`,
   * which is forwarded to the plugin's TeslaService.
   */
  async function setupCaller(opts: {
    encryptionKey?: string | null;
    serviceIo?: TeslaServiceIo;
    seedCredentials?: boolean;
  } = {}) {
    const encryptionKey = opts.encryptionKey ?? null;
    const db = new AppDatabase(":memory:", encryptionKey, null);
    await db.init();

    if (opts.seedCredentials !== false) {
      await db.setPluginConfig("tesla.client_id", "test-client-id");
      await db.setPluginConfig("tesla.client_secret", "test-client-secret");
      await db.setPluginConfig("tesla.region", "na");
    }

    const eventEmitter = new TypedEventEmitter();
    const vehicleRegistry = new VehiclePluginRegistry();
    const energyRegistry = new EnergyPluginRegistry();
    const vehicleManager = new VehicleManager(
      db,
      eventEmitter,
      testLogger,
      vehicleRegistry,
    );
    const energyManager = throwingMock<EnergyAdapterManager>(
      "EnergyAdapterManager",
    );

    const deps = PluginDependencies.create({
      db,
      vehicleManager,
      energyManager,
      tunnel: {
        getUrl: () => null,
        start: () => Promise.reject(new Error("tunnel not mocked")),
        stop: () => Promise.resolve(),
      },
      geocode: () => Promise.reject(new Error("geocode not mocked")),
      encryptionConfigured: () => false,
      pluginId: "tesla",
    });
    const proxyManager = new StubTeslaProxyManager(deps, deps.log);
    const plugin = new TeslaVehiclePlugin(deps, proxyManager, opts.serviceIo);
    vehicleRegistry.register(plugin);

    const appRouter = createAppRouter({
      vehicle: { tesla: createTeslaRouter(plugin, deps) },
      energy: {},
    });
    const createCaller = createCallerFactory(appRouter);

    const ctx = throwingMock<TrpcContext>("TrpcContext", {
      db,
      vehiclePlugins: vehicleRegistry,
      energyPlugins: energyRegistry,
      vehicleManager,
      encryptionKey,
      logger: testLogger,
    });

    const caller = createCaller(ctx);

    return {
      caller,
      db,
      plugin,
      cleanup: async () => {
        // Plugin startup is fire-and-forget in the ctor. Await its shutdown
        // (which itself awaits startupPromise) before closing the DB so no
        // in-flight query hits a closed connection.
        await plugin.shutdown();
        db.close();
      },
    };
  }

  let ctx: Awaited<ReturnType<typeof setupCaller>>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    ctx = await setupCaller();
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    await ctx.cleanup();
    globalThis.fetch = originalFetch;
  });

  describe("tesla.teslaStatus", () => {
    it("returns unauthenticated status when no tokens", async () => {
      const data = await ctx.caller.plugin.vehicle.tesla.teslaStatus();
      expect(data.authenticated).toBe(false);
      expect(data.vehicleConfigured).toBe(false);
      expect(data.vin).toBeNull();
    });

    it("returns authenticated status when tokens exist", async () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await seedTokens(ctx.db, "access", "refresh", expiresAt);

      const data = await ctx.caller.plugin.vehicle.tesla.teslaStatus();
      expect(data.authenticated).toBe(true);
    });
  });

  describe("tesla.getAuthUrl", () => {
    it("returns an authorization URL", async () => {
      const data = await ctx.caller.plugin.vehicle.tesla.getAuthUrl({
        origin: "https://chargeha.example.com",
      });
      expect(data.url).toContain("https://auth.tesla.com");
      expect(data.url).toContain("client_id=test-client-id");
    });
  });

  describe("tesla.selectVehicle", () => {
    it("saves vehicle to database", async () => {
      const data = await ctx.caller.plugin.vehicle.tesla.selectVehicle({
        vin: "VIN123",
        name: "My Tesla",
      });
      expect(data.success).toBe(true);

      const vehicle = await ctx.db.getVehicle("VIN123");
      assertExists(vehicle);
      expect(vehicle.name).toBe("My Tesla");
      expect(vehicle.adapterType).toBe("tesla");
    });
  });

  describe("tesla.selectVehicles", () => {
    it("saves all vehicles with their priorities", async () => {
      const data = await ctx.caller.plugin.vehicle.tesla.selectVehicles({
        vehicles: [
          { vin: "VIN1", name: "Car A", priority: 2 },
          { vin: "VIN2", name: "Car B", priority: 1 },
        ],
      });
      expect(data.success).toBe(true);
      expect(data.vins).toEqual(["VIN1", "VIN2"]);

      const carA = await ctx.db.getVehicle("VIN1");
      const carB = await ctx.db.getVehicle("VIN2");
      assertExists(carA);
      assertExists(carB);
      expect(carA.priority).toBe(2);
      expect(carB.priority).toBe(1);
    });

    it("rejects an empty vehicle list", async () => {
      await expect(
        ctx.caller.plugin.vehicle.tesla.selectVehicles({ vehicles: [] }),
      ).rejects.toThrow();
    });
  });

  describe("tesla.resetOnboarding", () => {
    it("clears config and removes Tesla vehicles", async () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await seedTokens(ctx.db, "access", "refresh", expiresAt);
      await ctx.db.upsertVehicle({
        id: "VIN123",
        name: "My Tesla",
        adapterType: "tesla",
        priority: 1,
        config: "{}",
        mode: "auto",
      });

      expect(await ctx.db.getPluginConfig("tesla.access_token")).toBe("access");
      expect(await ctx.db.getVehicle("VIN123")).not.toBeNull();

      const data = await ctx.caller.plugin.vehicle.tesla.resetOnboarding();
      expect(data.success).toBe(true);

      expect(await ctx.db.getPluginConfig("tesla.access_token")).toBeFalsy();
      expect(await ctx.db.getVehicle("VIN123")).toBeNull();
    });

    it("succeeds even when nothing is configured", async () => {
      const data = await ctx.caller.plugin.vehicle.tesla.resetOnboarding();
      expect(data.success).toBe(true);
    });
  });

  // Key generation / import now live on TeslaVehiclePlugin and write
  // through PluginDependencies (auto-prefixed to `tesla.*`).

  describe("tesla.generateKeys", () => {
    it("returns success and stores public key in DB (tesla-prefixed)", async () => {
      const keyCtx = await setupCaller({ encryptionKey: TEST_ENCRYPTION_KEY });
      try {
        const result = await keyCtx.caller.plugin.vehicle.tesla.generateKeys();
        expect(result.success).toBe(true);
        expect(result.publicKey).toContain("-----BEGIN PUBLIC KEY-----");

        const storedPublicKey = await keyCtx.db.getPluginConfig(
          "tesla.ec_public_key_pem",
        );
        expect(storedPublicKey).toContain("-----BEGIN PUBLIC KEY-----");
        expect(storedPublicKey).toBe(result.publicKey);
      } finally {
        await keyCtx.cleanup();
      }
    });

    it("stores encrypted private key when encryption key provided", async () => {
      const keyCtx = await setupCaller({ encryptionKey: TEST_ENCRYPTION_KEY });
      try {
        await keyCtx.caller.plugin.vehicle.tesla.generateKeys();
        const secret = await keyCtx.db.getSecret("tesla.ec_private_key");
        assertExists(secret);
        expect(secret.isEncrypted).toBe(true);
        expect(secret.value).not.toContain("-----BEGIN PRIVATE KEY-----");
        const decryptedPem = await decrypt(secret.value, TEST_ENCRYPTION_KEY);
        expect(decryptedPem).toContain("-----BEGIN PRIVATE KEY-----");
      } finally {
        await keyCtx.cleanup();
      }
    });

    it("stores plain private key when no encryption key", async () => {
      const result = await ctx.caller.plugin.vehicle.tesla.generateKeys();
      expect(result.success).toBe(true);

      const secret = await ctx.db.getSecret("tesla.ec_private_key");
      assertExists(secret);
      expect(secret.isEncrypted).toBe(false);
      expect(secret.value).toContain("-----BEGIN PRIVATE KEY-----");
    });
  });

  describe("tesla.importKeys", () => {
    const validPublicKey =
      "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest\n-----END PUBLIC KEY-----\n";
    const validPrivateKey =
      "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHtest\n-----END PRIVATE KEY-----\n";

    it("imports valid PEM keys and stores them under tesla.*", async () => {
      const result = await ctx.caller.plugin.vehicle.tesla.importKeys({
        publicKeyPem: validPublicKey,
        privateKeyPem: validPrivateKey,
      });
      expect(result.success).toBe(true);

      const storedPublicKey = await ctx.db.getPluginConfig(
        "tesla.ec_public_key_pem",
      );
      expect(storedPublicKey).toBe(validPublicKey);

      const secret = await ctx.db.getSecret("tesla.ec_private_key");
      assertExists(secret);
      expect(secret.isEncrypted).toBe(false);
      expect(secret.value).toBe(validPrivateKey);
    });

    it("encrypts private key when encryption key available", async () => {
      const keyCtx = await setupCaller({ encryptionKey: TEST_ENCRYPTION_KEY });
      try {
        await keyCtx.caller.plugin.vehicle.tesla.importKeys({
          publicKeyPem: validPublicKey,
          privateKeyPem: validPrivateKey,
        });

        const secret = await keyCtx.db.getSecret("tesla.ec_private_key");
        assertExists(secret);
        expect(secret.isEncrypted).toBe(true);

        const decrypted = await decrypt(secret.value, TEST_ENCRYPTION_KEY);
        expect(decrypted).toBe(validPrivateKey);
      } finally {
        await keyCtx.cleanup();
      }
    });

    it("rejects invalid private key format", async () => {
      await expect(
        ctx.caller.plugin.vehicle.tesla.importKeys({
          publicKeyPem: validPublicKey,
          privateKeyPem: "not a pem key",
        }),
      ).rejects.toThrow("Invalid private key");
    });
  });

  describe("tesla.registerPartner", () => {
    it("returns error when client credentials not configured", async () => {
      const freshCtx = await setupCaller({ seedCredentials: false });
      try {
        await expect(freshCtx.caller.plugin.vehicle.tesla.registerPartner())
          .rejects
          .toThrow("credentials not configured");
      } finally {
        await freshCtx.cleanup();
      }
    });

    it("returns error when domain not configured", async () => {
      await expect(ctx.caller.plugin.vehicle.tesla.registerPartner()).rejects
        .toThrow(
          "domain not configured",
        );
    });

    it("succeeds with mocked fetch", async () => {
      let capturedPartnerAuthHeader: string | undefined;
      const mockedCtx = await setupCaller({
        serviceIo: {
          fetch: (input, init) => {
            const url = extractFetchUrl(input);
            if (url.includes("fleet-auth") && url.includes("token")) {
              return Promise.resolve(
                new Response(
                  JSON.stringify({ access_token: "mock-partner-token" }),
                  {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                  },
                ),
              );
            }
            if (url.includes("partner_accounts")) {
              const headers = init?.headers as
                | Record<string, string>
                | undefined;
              capturedPartnerAuthHeader = headers?.Authorization;
              return Promise.resolve(
                new Response(
                  JSON.stringify({ response: { account_id: "abc123" } }),
                  {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                  },
                ),
              );
            }
            return Promise.resolve(new Response("", { status: 404 }));
          },
          connect: Deno.connect,
        },
      });
      try {
        await mockedCtx.db.setPluginConfig(
          "tesla.public_key_domain",
          "example.github.io",
        );
        const result = await mockedCtx.caller.plugin.vehicle.tesla
          .registerPartner();
        expect(result.success).toBe(true);
        expect(result.message).toContain("successful");
        expect(capturedPartnerAuthHeader).toBe("Bearer mock-partner-token");
      } finally {
        await mockedCtx.cleanup();
      }
    });
  });
});
