import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { AuthError, AuthService } from "../AuthService.ts";
import type { AppDatabase } from "../../db/AppDatabase.ts";
import { RateLimiter } from "../../middleware/rateLimit.ts";
import { FakeTime } from "@std/testing/time";
import {
  createMockConfigService,
  createMockDb,
  createMockLogger,
  createMockOidcService,
} from "../test-helpers/authMocks.ts";

describe("AuthService", () => {
  let service: AuthService;
  let mockDb: AppDatabase;
  let fakeTime: FakeTime;

  beforeEach(() => {
    fakeTime = new FakeTime();
    mockDb = createMockDb();
    service = new AuthService(
      mockDb,
      "test-key",
      createMockLogger(),
      createMockOidcService(),
      createMockConfigService(),
      new RateLimiter(),
    );
  });

  afterEach(() => {
    fakeTime.restore();
  });

  describe("changeMode()", () => {
    it("switches from none to local", async () => {
      let createdUser = null as {
        username: string;
        passwordHash: string;
      } | null;
      let sessionsDeleted = false;
      let authModeSet: string | null = null;

      mockDb = createMockDb({
        deleteAllSessions: () => {
          sessionsDeleted = true;
          return Promise.resolve();
        },
        createLocalUser: (
          input: { username: string; passwordHash: string },
        ) => {
          createdUser = input;
          return Promise.resolve(input);
        },
      });
      const configService = createMockConfigService("none", {
        setInternal: (input: { authMode?: string }) => {
          authModeSet = input.authMode ?? null;
          return Promise.resolve(false);
        },
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        configService,
        new RateLimiter(),
      );

      await service.changeMode({
        newMode: "local",
        localConfig: { username: "admin", password: "secure-password" },
      });

      expect(sessionsDeleted).toBe(true);
      assertExists(createdUser);
      expect(createdUser.username).toBe("admin");
      expect(createdUser.passwordHash).toMatch(/^\$argon2id\$/);
      expect(authModeSet).toBe("local");
    });

    it("switches from none to oidc (with encryption)", async () => {
      let oidcCreated = false;
      let capturedOidc = null as Record<string, unknown> | null;

      mockDb = createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        upsertOidcConfig: (input: Record<string, unknown>) => {
          oidcCreated = true;
          capturedOidc = input;
          return Promise.resolve(input);
        },
      });
      service = new AuthService(
        mockDb,
        // Use a valid 32-byte base64 key for encryption
        btoa(String.fromCharCode(...new Uint8Array(32).fill(1))),
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      await service.changeMode({
        newMode: "oidc",
        oidcConfig: {
          issuerUrl: "https://auth.example.com",
          clientId: "my-client",
          clientSecret: "my-secret",
          baseUrl: "https://app.example.com",
        },
      });

      expect(oidcCreated).toBe(true);
      assertExists(capturedOidc);
      expect(capturedOidc.issuerUrl).toBe("https://auth.example.com");
      expect(capturedOidc.clientId).toBe("my-client");
      expect(capturedOidc.isEncrypted).toBe(true);
      // clientSecret should be encrypted (not the original plaintext)
      expect(capturedOidc.clientSecret).not.toBe("my-secret");
    });

    it("switches from local to oidc with re-auth", async () => {
      const passwordHash = await service.hashPassword("current-pass");
      let localUsersDeleted = false;
      let oidcCreated = false;

      mockDb = createMockDb({
        getFirstLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        deleteAllSessions: () => Promise.resolve(),
        deleteAllLocalUsers: () => {
          localUsersDeleted = true;
          return Promise.resolve();
        },
        upsertOidcConfig: () => {
          oidcCreated = true;
          return Promise.resolve({});
        },
      });
      service = new AuthService(
        mockDb,
        null,
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("local"),
        new RateLimiter(),
      );

      await service.changeMode({
        newMode: "oidc",
        currentPassword: "current-pass",
        oidcConfig: {
          issuerUrl: "https://auth.example.com",
          clientId: "client",
          clientSecret: "secret",
          baseUrl: "https://app.example.com",
        },
      });

      expect(localUsersDeleted).toBe(true);
      expect(oidcCreated).toBe(true);
    });

    it("switches from oidc to local (no password re-auth needed)", async () => {
      let oidcDeleted = false;
      let localCreated = false;

      mockDb = createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        deleteAllOidcConfigs: () => {
          oidcDeleted = true;
          return Promise.resolve();
        },
        createLocalUser: () => {
          localCreated = true;
          return Promise.resolve({});
        },
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      await service.changeMode({
        newMode: "local",
        localConfig: { username: "admin", password: "new-password-123" },
      });

      expect(oidcDeleted).toBe(true);
      expect(localCreated).toBe(true);
    });

    it("switches from local to none with re-auth", async () => {
      const passwordHash = await service.hashPassword("my-pass");
      let localUsersDeleted = false;
      let authModeSet: string | null = null;

      mockDb = createMockDb({
        getFirstLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        deleteAllSessions: () => Promise.resolve(),
        deleteAllLocalUsers: () => {
          localUsersDeleted = true;
          return Promise.resolve();
        },
      });
      const configService = createMockConfigService("local", {
        setInternal: (input: { authMode?: string }) => {
          authModeSet = input.authMode ?? null;
          return Promise.resolve(false);
        },
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        configService,
        new RateLimiter(),
      );

      await service.changeMode(
        { newMode: "none", currentPassword: "my-pass" },
      );

      expect(localUsersDeleted).toBe(true);
      expect(authModeSet).toBe("none");
    });

    it("switches from oidc to none", async () => {
      let oidcDeleted = false;

      mockDb = createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        deleteAllOidcConfigs: () => {
          oidcDeleted = true;
          return Promise.resolve();
        },
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      await service.changeMode({ newMode: "none" });

      expect(oidcDeleted).toBe(true);
    });

    it("throws UNAUTHORIZED when no local user found during re-auth", async () => {
      mockDb = createMockDb({
        getFirstLocalUser: () => Promise.resolve(null),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("local"),
        new RateLimiter(),
      );

      try {
        await service.changeMode({
          newMode: "none",
          currentPassword: "some-password",
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("UNAUTHORIZED");
        expect((err as AuthError).message).toBe("Invalid credentials");
      }
    });

    it("throws UNAUTHORIZED when re-auth password is wrong (local → oidc)", async () => {
      const passwordHash = await service.hashPassword("correct");
      mockDb = createMockDb({
        getFirstLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("local"),
        new RateLimiter(),
      );

      try {
        await service.changeMode({
          newMode: "oidc",
          currentPassword: "wrong-password",
          oidcConfig: {
            issuerUrl: "https://auth.example.com",
            clientId: "c",
            clientSecret: "s",
            baseUrl: "https://app.example.com",
          },
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("UNAUTHORIZED");
      }
    });

    it("throws UNAUTHORIZED when re-auth password is missing (local → none)", async () => {
      mockDb = createMockDb();
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("local"),
        new RateLimiter(),
      );

      try {
        await service.changeMode({ newMode: "none" });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("UNAUTHORIZED");
        expect((err as AuthError).message).toContain("password required");
      }
    });

    it("throws BAD_REQUEST when local password is empty", async () => {
      mockDb = createMockDb();
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      try {
        await service.changeMode({
          newMode: "local",
          localConfig: { username: "admin", password: "" },
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("BAD_REQUEST");
        expect((err as AuthError).message).toContain("at least 1 character");
      }
    });

    it("throws BAD_REQUEST when local username is empty", async () => {
      mockDb = createMockDb();
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      try {
        await service.changeMode({
          newMode: "local",
          localConfig: { username: "", password: "long-enough-password" },
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("BAD_REQUEST");
        expect((err as AuthError).message).toContain("Username is required");
      }
    });

    it("throws BAD_REQUEST when OIDC discovery endpoint is unreachable", async () => {
      mockDb = createMockDb();
      const oidcService = createMockOidcService({
        testDiscovery: () =>
          Promise.resolve({
            success: false,
            error: "Discovery endpoint unreachable: Network error",
          }),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        oidcService,
        createMockConfigService(),
        new RateLimiter(),
      );

      await expect(
        service.changeMode({
          newMode: "oidc",
          oidcConfig: {
            issuerUrl: "https://unreachable.example.com",
            clientId: "c",
            clientSecret: "s",
            baseUrl: "https://app.example.com",
          },
        }),
      ).rejects.toThrow("Discovery endpoint unreachable: Network error");
    });

    it("throws BAD_REQUEST when OIDC discovery returns non-OK status", async () => {
      mockDb = createMockDb();
      const oidcService = createMockOidcService({
        testDiscovery: () =>
          Promise.resolve({
            success: false,
            error: "Discovery endpoint returned 404",
          }),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        oidcService,
        createMockConfigService(),
        new RateLimiter(),
      );

      await expect(
        service.changeMode({
          newMode: "oidc",
          oidcConfig: {
            issuerUrl: "https://bad.example.com",
            clientId: "c",
            clientSecret: "s",
            baseUrl: "https://app.example.com",
          },
        }),
      ).rejects.toThrow("Discovery endpoint returned 404");
    });

    it("returns session ID when switching to local mode (auto-login)", async () => {
      let sessionCreated = false;
      mockDb = createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        createLocalUser: () => Promise.resolve({}),
        createSession: (input: unknown) => {
          sessionCreated = true;
          return Promise.resolve(input);
        },
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const sessionId = await service.changeMode({
        newMode: "local",
        localConfig: { username: "admin", password: "secure-password" },
      });

      assertExists(sessionId);
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
      expect(sessionCreated).toBe(true);
    });

    it("returns null when switching to none mode (no auto-login)", async () => {
      mockDb = createMockDb({
        deleteAllSessions: () => Promise.resolve(),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const sessionId = await service.changeMode({ newMode: "none" });

      expect(sessionId).toBeNull();
    });

    it("returns null when switching to oidc mode (no auto-login)", async () => {
      mockDb = createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        upsertOidcConfig: () => Promise.resolve({}),
      });
      service = new AuthService(
        mockDb,
        null,
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const sessionId = await service.changeMode({
        newMode: "oidc",
        oidcConfig: {
          issuerUrl: "https://auth.example.com",
          clientId: "client",
          clientSecret: "secret",
          baseUrl: "https://app.example.com",
        },
      });

      expect(sessionId).toBeNull();
    });

    it("stores OIDC client_secret unencrypted when no encryption key", async () => {
      let capturedOidc = null as Record<string, unknown> | null;

      mockDb = createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        upsertOidcConfig: (input: Record<string, unknown>) => {
          capturedOidc = input;
          return Promise.resolve(input);
        },
      });
      // No encryption key
      service = new AuthService(
        mockDb,
        null,
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      await service.changeMode({
        newMode: "oidc",
        oidcConfig: {
          issuerUrl: "https://auth.example.com",
          clientId: "client",
          clientSecret: "plain-secret",
          baseUrl: "https://app.example.com",
        },
      });

      assertExists(capturedOidc);
      expect(capturedOidc.isEncrypted).toBe(false);
      expect(capturedOidc.clientSecret).toBe("plain-secret");
    });
  });

  // ── handleLogin ────────────────────────────────────────────────────────
});
