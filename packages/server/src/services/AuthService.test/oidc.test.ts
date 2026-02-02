import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { AuthError, AuthService } from "../AuthService.ts";
import { RateLimiter } from "../../middleware/rateLimit.ts";
import { FakeTime } from "@std/testing/time";
import {
  createMockConfigService,
  createMockDb,
  createMockLogger,
  createMockOidcService,
} from "../test-helpers/authMocks.ts";

describe("AuthService (OIDC)", () => {
  let fakeTime: FakeTime;

  beforeEach(() => {
    fakeTime = new FakeTime();
  });

  afterEach(() => {
    fakeTime.restore();
  });

  describe("activateWizardOidc()", () => {
    it("deletes all sessions and local users", async () => {
      let sessionsDeleted = false;
      let usersDeleted = false;
      const db = createMockDb({
        deleteAllSessions: () => {
          sessionsDeleted = true;
          return Promise.resolve();
        },
        deleteAllLocalUsers: () => {
          usersDeleted = true;
          return Promise.resolve();
        },
      });
      const configService = createMockConfigService("none");
      const svc = new AuthService(
        db,
        null,
        createMockLogger(),
        createMockOidcService(),
        configService,
        new RateLimiter(),
      );

      await svc.activateWizardOidc("oidc-sub-123", "user@example.com");

      expect(sessionsDeleted).toBe(true);
      expect(usersDeleted).toBe(true);
    });

    it("sets auth mode to oidc via configService", async () => {
      let setAuthMode: string | undefined;
      const configService = createMockConfigService("none", {
        setInternal: (input: { authMode?: string }) => {
          setAuthMode = input.authMode;
          return Promise.resolve(false);
        },
      });
      const svc = new AuthService(
        createMockDb(),
        null,
        createMockLogger(),
        createMockOidcService(),
        configService,
        new RateLimiter(),
      );

      await svc.activateWizardOidc("oidc-sub-123", "user@example.com");

      expect(setAuthMode).toBe("oidc");
    });

    it("creates a session and returns its ID", async () => {
      const db = createMockDb();
      const configService = createMockConfigService("none");
      const svc = new AuthService(
        db,
        null,
        createMockLogger(),
        createMockOidcService(),
        configService,
        new RateLimiter(),
      );

      const sessionId = await svc.activateWizardOidc(
        "oidc-sub-123",
        "user@example.com",
      );

      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
    });
  });

  // ── updateOidcConfig ─────────────────────────────────────────────────

  describe("updateOidcConfig()", () => {
    it("saves config on success", async () => {
      let upsertCalled = false;
      const db = createMockDb({
        upsertOidcConfig: () => {
          upsertCalled = true;
          return Promise.resolve({});
        },
      });
      const oidcService = createMockOidcService({
        testDiscovery: () => Promise.resolve({ success: true }),
      });
      const svc = new AuthService(
        db,
        null,
        createMockLogger(),
        oidcService,
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      const result = await svc.updateOidcConfig({
        issuerUrl: "https://new-auth.example.com",
        clientId: "new-client",
        clientSecret: "new-secret",
        baseUrl: "https://app.example.com",
      });

      expect(result).toEqual({ success: true });
      expect(upsertCalled).toBe(true);
    });

    it("throws BAD_REQUEST when discovery fails", async () => {
      const oidcService = createMockOidcService({
        testDiscovery: () =>
          Promise.resolve({ success: false, error: "Discovery failed" }),
      });
      const svc = new AuthService(
        createMockDb(),
        null,
        createMockLogger(),
        oidcService,
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      try {
        await svc.updateOidcConfig({
          issuerUrl: "https://bad.example.com",
          clientId: "client",
          clientSecret: "secret",
          baseUrl: "https://app.example.com",
        });
        expect(true).toBe(false); // should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("BAD_REQUEST");
        expect((err as AuthError).message).toBe("Discovery failed");
      }
    });

    it("encrypts client secret when encryption key is available", async () => {
      let savedConfig = null as {
        clientSecret: string;
        isEncrypted: boolean;
      } | null;
      const db = createMockDb({
        upsertOidcConfig: (config: {
          clientSecret: string;
          isEncrypted: boolean;
        }) => {
          savedConfig = config;
          return Promise.resolve({});
        },
      });
      const oidcService = createMockOidcService({
        testDiscovery: () => Promise.resolve({ success: true }),
      });
      // Use a valid 32-byte base64 key for encryption
      const validKey = btoa(
        String.fromCharCode(...new Uint8Array(32).fill(1)),
      );
      const svc = new AuthService(
        db,
        validKey,
        createMockLogger(),
        oidcService,
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      await svc.updateOidcConfig({
        issuerUrl: "https://auth.example.com",
        clientId: "client",
        clientSecret: "plain-secret",
        baseUrl: "https://app.example.com",
      });

      assertExists(savedConfig);
      expect(savedConfig.isEncrypted).toBe(true);
      // Encrypted value should differ from original
      expect(savedConfig.clientSecret).not.toBe("plain-secret");
    });

    it("stores plaintext secret when no encryption key", async () => {
      let savedConfig = null as {
        clientSecret: string;
        isEncrypted: boolean;
      } | null;
      const db = createMockDb({
        upsertOidcConfig: (config: {
          clientSecret: string;
          isEncrypted: boolean;
        }) => {
          savedConfig = config;
          return Promise.resolve({});
        },
      });
      const oidcService = createMockOidcService({
        testDiscovery: () => Promise.resolve({ success: true }),
      });
      const svc = new AuthService(
        db,
        null,
        createMockLogger(),
        oidcService,
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      await svc.updateOidcConfig({
        issuerUrl: "https://auth.example.com",
        clientId: "client",
        clientSecret: "plain-secret",
        baseUrl: "https://app.example.com",
      });

      assertExists(savedConfig);
      expect(savedConfig.isEncrypted).toBe(false);
      expect(savedConfig.clientSecret).toBe("plain-secret");
    });
  });

  // ── handleUpdateOidcConfig ──────────────────────────────────────────────

  describe("handleUpdateOidcConfig()", () => {
    it("delegates to updateOidcConfig and returns success", async () => {
      let upsertCalled = false;
      const db = createMockDb({
        upsertOidcConfig: () => {
          upsertCalled = true;
          return Promise.resolve({});
        },
      });
      const oidcService = createMockOidcService({
        testDiscovery: () => Promise.resolve({ success: true }),
      });
      const svc = new AuthService(
        db,
        null,
        createMockLogger(),
        oidcService,
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      const result = await svc.handleUpdateOidcConfig({
        issuerUrl: "https://auth.example.com",
        clientId: "client",
        clientSecret: "secret",
        baseUrl: "https://app.example.com",
      });

      expect(result).toEqual({ success: true });
      expect(upsertCalled).toBe(true);
    });
  });

  // ── getOidcConfig ─────────────────────────────────────────────────────

  describe("getOidcConfig()", () => {
    it("returns config when OIDC config exists", async () => {
      const db = createMockDb({
        getOidcConfig: () =>
          Promise.resolve({
            issuerUrl: "https://auth.example.com",
            clientId: "my-client",
            clientSecret: "encrypted-secret",
            isEncrypted: true,
            baseUrl: "https://app.example.com",
          }),
      });
      const svc = new AuthService(
        db,
        null,
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      const result = await svc.getOidcConfig();
      expect(result).toEqual({
        issuerUrl: "https://auth.example.com",
        clientId: "my-client",
        baseUrl: "https://app.example.com",
      });
    });

    it("returns null when no OIDC config exists", async () => {
      const db = createMockDb({
        getOidcConfig: () => Promise.resolve(null),
      });
      const svc = new AuthService(
        db,
        null,
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("none"),
        new RateLimiter(),
      );

      const result = await svc.getOidcConfig();
      expect(result).toBeNull();
    });
  });

  // ── Cookie helpers ────────────────────────────────────────────────────
});
