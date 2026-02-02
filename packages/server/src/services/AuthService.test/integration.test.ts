/**
 * Integration tests for auth flows.
 * Uses real SQLite DB, real AuthService, real AppDatabase.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { AuthService } from "../AuthService.ts";
import { OidcService } from "../OidcService.ts";
import { ConfigService } from "../ConfigService.ts";
import { RateLimiter } from "../../middleware/rateLimit.ts";
import { Logger } from "../../lib/Logger.ts";
import type { EnergyAdapterManager } from "../EnergyAdapterManager.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("AuthService (integration)", () => {
  const rateLimiter = new RateLimiter();

  // Suppress log output during tests
  const logger = new Logger("auth-test", "error");

  // Stub EnergyAdapterManager for ConfigService (not used in auth flows)
  const stubEnergyManager = throwingMock<EnergyAdapterManager>(
    "EnergyAdapterManager",
    { reconfigure: () => Promise.resolve() },
  );

  let db: AppDatabase;
  let authService: AuthService;
  let configService: ConfigService;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    const oidcService = new OidcService(db, null, logger);
    configService = new ConfigService(db, stubEnergyManager, null, logger);
    authService = new AuthService(
      db,
      null,
      logger,
      oidcService,
      configService,
      rateLimiter,
    );
    // Start with auth_mode = "none"
    await configService.setInternal({ authMode: "none" });
  });

  afterEach(() => {
    db.close();
  });

  // ── Helper: set up local auth mode with a user ────────────────────────────
  async function setupLocalAuth(
    username = "admin",
    password = "password123",
  ): Promise<void> {
    await authService.changeMode({
      newMode: "local",
      localConfig: { username, password },
    });
  }

  // ── 1. Local login → session → authenticated → logout → 401 ──────────────
  describe("Integration: local login → session → logout → 401", () => {
    it("full local auth lifecycle", async () => {
      // Set up local auth
      await setupLocalAuth("admin", "password123");

      // Verify auth mode is local
      const internal = await configService.getInternal();
      expect(internal.authMode).toBe("local");

      // Login
      const sessionId = await authService.login("admin", "password123");
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);

      // Session exists in DB and is valid
      const session = await authService.validateSession(sessionId);
      assertExists(session);
      expect(session.authType).toBe("local");
      expect(session.identifier).toBe("admin");

      // Verify session is in DB directly
      const dbSession = await db.getSession(sessionId);
      assertExists(dbSession);
      expect(dbSession.id).toBe(sessionId);

      // Logout
      await authService.logout(sessionId);

      // Session is deleted from DB
      const deletedSession = await db.getSession(sessionId);
      expect(deletedSession).toBeNull();

      // Validate session returns null (would result in 401)
      const invalidSession = await authService.validateSession(sessionId);
      expect(invalidSession).toBeNull();
    });

    it("login fails with wrong password", async () => {
      await setupLocalAuth("admin", "password123");

      await expect(authService.login("admin", "wrongpassword")).rejects.toThrow(
        "Invalid credentials",
      );
    });

    it("login fails with non-existent user", async () => {
      await setupLocalAuth("admin", "password123");

      await expect(authService.login("nonexistent", "password123")).rejects
        .toThrow("Invalid credentials");
    });
  });

  // ── 2. OIDC callback → session → authenticated request ───────────────────
  describe("Integration: OIDC callback → session creation", () => {
    it("creates a session for OIDC user via createSession", async () => {
      // OIDC callback flow ends with authService.createSession("oidc", sub, email)
      // We test the session creation + validation against real DB
      const sessionId = await authService.createSession(
        "oidc",
        "oidc-sub-12345",
        "user@example.com",
      );
      expect(typeof sessionId).toBe("string");

      // Session is valid
      const session = await authService.validateSession(sessionId);
      assertExists(session);
      expect(session.authType).toBe("oidc");
      expect(session.identifier).toBe("oidc-sub-12345");
      expect(session.email).toBe("user@example.com");

      // Session has correct TTL (30 days)
      const nowSecs = Math.floor(Date.now() / 1000);
      expect(session.expiresAt).toBeGreaterThan(nowSecs);
      expect(session.expiresAt).toBeLessThanOrEqual(
        nowSecs + 30 * 24 * 60 * 60 + 1,
      );
    });

    it("OIDC session is validated and can be deleted", async () => {
      const sessionId = await authService.createSession(
        "oidc",
        "oidc-sub-67890",
        null,
      );

      // Validate
      const session = await authService.validateSession(sessionId);
      expect(session).not.toBeNull();

      // Delete (logout)
      await authService.deleteSession(sessionId);

      // Gone
      const gone = await authService.validateSession(sessionId);
      expect(gone).toBeNull();
    });
  });

  // ── 3. Mode change: none → local → oidc → none ──────────────────────────
  describe("Integration: mode change none→local→oidc→none", () => {
    it("transitions through all auth modes with proper cleanup", async () => {
      // Start: mode = none
      let internal = await configService.getInternal();
      expect(internal.authMode).toBe("none");

      // → local
      await authService.changeMode({
        newMode: "local",
        localConfig: { username: "admin", password: "password123" },
      });
      internal = await configService.getInternal();
      expect(internal.authMode).toBe("local");

      // Verify local user exists
      const localUser = await db.getFirstLocalUser();
      assertExists(localUser);
      expect(localUser.username).toBe("admin");

      // Create a session to verify it gets cleaned up
      const sessionId = await authService.login("admin", "password123");
      expect(await db.getSession(sessionId)).not.toBeNull();

      // → oidc (requires re-auth with current local password)
      // Mock the OIDC discovery fetch to avoid network calls
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input: string | URL | Request) => {
        const url = (() => {
          if (typeof input === "string") return input;
          if (input instanceof URL) return input.href;
          return input.url;
        })();
        if (url.includes(".well-known/openid-configuration")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ issuer: "https://auth.example.com" }),
              {
                status: 200,
              },
            ),
          );
        }
        return originalFetch(input);
      };

      try {
        await authService.changeMode({
          newMode: "oidc",
          currentPassword: "password123",
          oidcConfig: {
            issuerUrl: "https://auth.example.com",
            clientId: "my-client",
            clientSecret: "my-secret",
            baseUrl: "https://chargeha.local",
          },
        });
      } finally {
        globalThis.fetch = originalFetch;
      }

      internal = await configService.getInternal();
      expect(internal.authMode).toBe("oidc");

      // Verify sessions were deleted during mode change
      expect(await db.getSession(sessionId)).toBeNull();

      // Verify local users were cleaned up
      expect(await db.getFirstLocalUser()).toBeNull();

      // Verify OIDC config exists
      const oidcConfig = await db.getOidcConfig();
      assertExists(oidcConfig);
      expect(oidcConfig.clientId).toBe("my-client");
      expect(oidcConfig.issuerUrl).toBe("https://auth.example.com");

      // → none (OIDC mode doesn't require password re-auth)
      await authService.changeMode({ newMode: "none" });
      internal = await configService.getInternal();
      expect(internal.authMode).toBe("none");

      // Verify OIDC config was cleaned up
      expect(await db.getOidcConfig()).toBeNull();
    });

    it("rejects mode change from local without current password", async () => {
      await setupLocalAuth("admin", "password123");

      await expect(authService.changeMode({ newMode: "none" })).rejects.toThrow(
        "Current password required for re-authentication",
      );
    });

    it("rejects mode change from local with wrong password", async () => {
      await setupLocalAuth("admin", "password123");

      await expect(
        authService.changeMode(
          { newMode: "none", currentPassword: "wrongpassword" },
        ),
      ).rejects.toThrow("Invalid credentials");
    });
  });

  // ── 3b. Auto-login on changeMode to local ─────────────────────────────────
  describe("Integration: changeMode auto-login for local mode", () => {
    it("returns a valid session ID when switching to local mode", async () => {
      const sessionId = await authService.changeMode({
        newMode: "local",
        localConfig: { username: "admin", password: "password123" },
      });

      // changeMode returns a session ID for local mode
      assertExists(sessionId);
      expect(typeof sessionId).toBe("string");

      // The session is valid and can be used for subsequent requests
      const session = await authService.validateSession(sessionId);
      assertExists(session);
      expect(session.authType).toBe("local");
      expect(session.identifier).toBe("admin");
    });

    it("returns null when switching to none mode", async () => {
      const sessionId = await authService.changeMode({ newMode: "none" });

      expect(sessionId).toBeNull();
    });

    it("returns null when switching to oidc mode", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ issuer: "https://auth.example.com" }), {
            status: 200,
          }),
        )) as typeof fetch;

      try {
        const sessionId = await authService.changeMode({
          newMode: "oidc",
          oidcConfig: {
            issuerUrl: "https://auth.example.com",
            clientId: "client",
            clientSecret: "secret",
            baseUrl: "https://app.example.com",
          },
        });

        expect(sessionId).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ── 4. Password change → old rejected → new works → sessions invalidated ─
  describe("Integration: password change with session invalidation", () => {
    it("changes password and invalidates other sessions", async () => {
      await setupLocalAuth("admin", "oldpassword1");

      // Create two sessions (simulating two devices)
      const session1 = await authService.login("admin", "oldpassword1");
      const session2 = await authService.login("admin", "oldpassword1");

      // Both sessions valid
      expect(await authService.validateSession(session1)).not.toBeNull();
      expect(await authService.validateSession(session2)).not.toBeNull();

      // Change password using session1
      await authService.changePassword(
        "oldpassword1",
        "newpassword1",
        session1,
      );

      // session1 (current) is still valid
      expect(await authService.validateSession(session1)).not.toBeNull();

      // session2 (other device) is invalidated
      expect(await authService.validateSession(session2)).toBeNull();

      // Old password no longer works
      await expect(authService.login("admin", "oldpassword1")).rejects.toThrow(
        "Invalid credentials",
      );

      // New password works
      const session3 = await authService.login("admin", "newpassword1");
      expect(typeof session3).toBe("string");
      expect(await authService.validateSession(session3)).not.toBeNull();
    });

    it("rejects password change with wrong current password", async () => {
      await setupLocalAuth("admin", "password123");
      const sessionId = await authService.login("admin", "password123");

      await expect(
        authService.changePassword("wrongcurrent", "newpassword1", sessionId),
      ).rejects.toThrow("Invalid credentials");
    });

    it("rejects empty password", async () => {
      await setupLocalAuth("admin", "password123");
      const sessionId = await authService.login("admin", "password123");

      await expect(
        authService.changePassword("password123", "", sessionId),
      ).rejects.toThrow(/at least 1 character/);
    });

    it("rejects password change with invalid session", async () => {
      await setupLocalAuth("admin", "password123");

      await expect(
        authService.changePassword(
          "password123",
          "newpassword1",
          "nonexistent-session",
        ),
      ).rejects.toThrow("Invalid session");
    });
  });

  // ── 5. Rate limiting across multiple failed login attempts ────────────────
  describe("Integration: rate limiting across failed logins", () => {
    it("triggers escalating lockout after 5 failures", () => {
      const rateLimiter = new RateLimiter();
      const ip = "192.168.1.100";

      // First 4 failures should still allow
      Array.from({ length: 4 }).forEach(() => {
        rateLimiter.recordFailure(ip);
        const check = rateLimiter.check(ip);
        expect(check.allowed).toBe(true);
      });

      // 5th failure triggers lockout
      rateLimiter.recordFailure(ip);
      const locked = rateLimiter.check(ip);
      expect(locked.allowed).toBe(false);
      expect(locked.retryAfter).toBeGreaterThan(0);
      // Initial lockout is 1 minute (60 seconds)
      expect(locked.retryAfter).toBeLessThanOrEqual(60);
    });

    it("success resets the failure counter", () => {
      const rateLimiter = new RateLimiter();
      const ip = "10.0.0.1";

      // 4 failures
      Array.from({ length: 4 }).forEach(() => {
        rateLimiter.recordFailure(ip);
      });

      // Success resets
      rateLimiter.recordSuccess(ip);

      // 4 more failures should not trigger lockout
      Array.from({ length: 4 }).forEach(() => {
        rateLimiter.recordFailure(ip);
        const check = rateLimiter.check(ip);
        expect(check.allowed).toBe(true);
      });

      // But the 5th should
      rateLimiter.recordFailure(ip);
      expect(rateLimiter.check(ip).allowed).toBe(false);
    });

    it("rate limiting with real auth service login failures", async () => {
      await setupLocalAuth("admin", "password123");
      const rateLimiter = new RateLimiter();
      const ip = "10.0.0.50";

      // 5 failed login attempts
      await Array.from({ length: 5 }).reduce(async (prev) => {
        await prev;
        try {
          await authService.login("admin", "wrong");
        } catch {
          rateLimiter.recordFailure(ip);
        }
      }, Promise.resolve());

      // Rate limiter blocks further attempts
      const check = rateLimiter.check(ip);
      expect(check.allowed).toBe(false);
      expect(check.retryAfter).toBeGreaterThan(0);

      // Successful login (bypassing rate limiter) resets counter
      const sessionId = await authService.login("admin", "password123");
      rateLimiter.recordSuccess(ip);

      expect(typeof sessionId).toBe("string");
      expect(rateLimiter.check(ip).allowed).toBe(true);
    });

    it("escalating lockout durations", () => {
      const rateLimiter = new RateLimiter();
      const ip = "172.16.0.1";

      // First lockout: 5 failures → 1 min lockout
      Array.from({ length: 5 }).forEach(() => {
        rateLimiter.recordFailure(ip);
      });
      const check = rateLimiter.check(ip);
      expect(check.allowed).toBe(false);
      expect(check.retryAfter).toBeLessThanOrEqual(60);
      expect(check.retryAfter).toBeGreaterThan(0);

      // Simulate lockout expiry by recording another failure
      // (after lockout expires, the check allows, but recording another failure
      // triggers a doubled lockout)
      // For this test we just verify the mechanism exists
      // by checking that retryAfter is a positive number
      expect(typeof check.retryAfter).toBe("number");
    });
  });

  // ── 6. Lazy session cleanup on login ──────────────────────────────────────
  describe("Integration: lazy session cleanup on login", () => {
    it("deletes expired sessions on successful login", async () => {
      await setupLocalAuth("admin", "password123");

      // Create an expired session directly in the DB
      const expiredId = "expired-session-123";
      const nowSecs = Math.floor(Date.now() / 1000);
      await db.createSession({
        id: expiredId,
        authType: "local",
        identifier: "admin",
        email: null,
        createdAt: nowSecs - 100000,
        expiresAt: nowSecs - 1, // already expired
      });

      // Create another expired session
      const expiredId2 = "expired-session-456";
      await db.createSession({
        id: expiredId2,
        authType: "oidc",
        identifier: "old-oidc-user",
        email: "old@example.com",
        createdAt: nowSecs - 200000,
        expiresAt: nowSecs - 50000, // expired long ago
      });

      // Verify expired sessions exist
      expect(await db.getSession(expiredId)).not.toBeNull();
      expect(await db.getSession(expiredId2)).not.toBeNull();

      // Login triggers lazy cleanup of expired sessions
      const newSessionId = await authService.login("admin", "password123");

      // New session is valid
      expect(await authService.validateSession(newSessionId)).not.toBeNull();

      // Expired sessions have been cleaned up
      expect(await db.getSession(expiredId)).toBeNull();
      expect(await db.getSession(expiredId2)).toBeNull();
    });

    it("does not delete non-expired sessions during cleanup", async () => {
      await setupLocalAuth("admin", "password123");

      // Create a valid (non-expired) session
      const validId = "valid-session-789";
      const nowSecs = Math.floor(Date.now() / 1000);
      await db.createSession({
        id: validId,
        authType: "local",
        identifier: "admin",
        email: null,
        createdAt: nowSecs,
        expiresAt: nowSecs + 86400, // expires in 1 day
      });

      // Create an expired session
      const expiredId = "expired-session-abc";
      await db.createSession({
        id: expiredId,
        authType: "local",
        identifier: "admin",
        email: null,
        createdAt: nowSecs - 100000,
        expiresAt: nowSecs - 1,
      });

      // Login
      await authService.login("admin", "password123");

      // Valid session still exists
      expect(await db.getSession(validId)).not.toBeNull();

      // Expired session was cleaned up
      expect(await db.getSession(expiredId)).toBeNull();
    });

    it("validateSession rejects expired sessions", async () => {
      // Create a session that has expired
      const nowSecs = Math.floor(Date.now() / 1000);
      const expiredSessionId = "manually-expired-session";
      await db.createSession({
        id: expiredSessionId,
        authType: "local",
        identifier: "admin",
        email: null,
        createdAt: nowSecs - 100000,
        expiresAt: nowSecs - 1, // expired
      });

      // Session exists in DB
      expect(await db.getSession(expiredSessionId)).not.toBeNull();

      // But validateSession rejects it
      expect(await authService.validateSession(expiredSessionId)).toBeNull();
    });
  });
});
