import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  AuthError,
  AuthService,
  buildClearCookie,
  buildSessionCookie,
} from "../AuthService.ts";
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

  describe("handleLogin()", () => {
    it("returns success and sets session cookie", async () => {
      const passwordHash = await service.hashPassword("correct");
      mockDb = createMockDb({
        getLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        createSession: (input: unknown) => Promise.resolve(input),
        deleteExpiredSessions: () => Promise.resolve(),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const responseHeaders = new Headers();
      const result = await service.handleLogin(
        "admin",
        "correct",
        "127.0.0.1",
        responseHeaders,
        false,
      );

      expect(result).toEqual({ success: true });
      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("session_id=");
      expect(cookie).toContain("HttpOnly");
    });

    it("returns success without setting cookie when no responseHeaders", async () => {
      const passwordHash = await service.hashPassword("correct");
      mockDb = createMockDb({
        getLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        createSession: (input: unknown) => Promise.resolve(input),
        deleteExpiredSessions: () => Promise.resolve(),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const result = await service.handleLogin(
        "admin",
        "correct",
        "127.0.0.1",
      );

      expect(result).toEqual({ success: true });
    });

    it("throws TOO_MANY_REQUESTS when rate limited", async () => {
      const rateLimiter = new RateLimiter();
      Array.from({ length: 5 }).forEach(() => {
        rateLimiter.recordFailure("10.0.0.1");
      });

      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        rateLimiter,
      );

      try {
        await service.handleLogin("admin", "pass", "10.0.0.1");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("TOO_MANY_REQUESTS");
        const parsed = JSON.parse((err as AuthError).message);
        expect(parsed.retryAfter).toBeGreaterThan(0);
      }
    });

    it("records failure on rate limiter when login fails", async () => {
      const rateLimiter = new RateLimiter();
      mockDb = createMockDb({
        getLocalUser: () => Promise.resolve(null),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        rateLimiter,
      );

      await Array.from({ length: 5 }).reduce(async (prev) => {
        await prev;
        try {
          await service.handleLogin("admin", "wrong", "10.0.0.2");
        } catch (error) {
          // expected
          expect(error).toBeDefined();
        }
      }, Promise.resolve());

      // 6th attempt should be rate limited
      try {
        await service.handleLogin("admin", "wrong", "10.0.0.2");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as AuthError).code).toBe("TOO_MANY_REQUESTS");
      }
    });

    it("records success on rate limiter when login succeeds", async () => {
      const rateLimiter = new RateLimiter();
      const passwordHash = await service.hashPassword("correct");
      mockDb = createMockDb({
        getLocalUser: (_username: string) =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        createSession: (input: unknown) => Promise.resolve(input),
        deleteExpiredSessions: () => Promise.resolve(),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        rateLimiter,
      );

      // 4 failures
      Array.from({ length: 4 }).forEach(() => {
        rateLimiter.recordFailure("10.0.0.3");
      });

      // Success resets counter
      await service.handleLogin("admin", "correct", "10.0.0.3");

      // 4 more failures should not trigger lockout
      Array.from({ length: 4 }).forEach(() => {
        rateLimiter.recordFailure("10.0.0.3");
      });
      expect(rateLimiter.check("10.0.0.3").allowed).toBe(true);
    });

    it("sets Secure flag when isHttps is true", async () => {
      const passwordHash = await service.hashPassword("correct");
      mockDb = createMockDb({
        getLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        createSession: (input: unknown) => Promise.resolve(input),
        deleteExpiredSessions: () => Promise.resolve(),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const responseHeaders = new Headers();
      await service.handleLogin(
        "admin",
        "correct",
        "127.0.0.1",
        responseHeaders,
        true,
      );

      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("Secure");
    });
  });

  // ── handleLogout ───────────────────────────────────────────────────────

  describe("handleLogout()", () => {
    it("deletes session and clears cookie", async () => {
      let deletedId: string | null = null;
      mockDb = createMockDb({
        deleteSession: (id: string) => {
          deletedId = id;
          return Promise.resolve();
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

      const responseHeaders = new Headers();
      const result = await service.handleLogout(
        "sess-abc",
        responseHeaders,
        false,
      );

      expect(result).toEqual({ success: true });
      expect(deletedId).toBe("sess-abc");
      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("Max-Age=0");
    });

    it("clears cookie even when no sessionId is present", async () => {
      let logoutCalled = false;
      mockDb = createMockDb({
        deleteSession: () => {
          logoutCalled = true;
          return Promise.resolve();
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

      const responseHeaders = new Headers();
      const result = await service.handleLogout(null, responseHeaders, false);

      expect(result).toEqual({ success: true });
      expect(logoutCalled).toBe(false);
      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("Max-Age=0");
    });

    it("sets Secure flag when isHttps is true", async () => {
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const responseHeaders = new Headers();
      await service.handleLogout("sess-1", responseHeaders, true);

      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("Secure");
    });

    it("returns success without setting cookie when no responseHeaders", async () => {
      let deletedId: string | null = null;
      mockDb = createMockDb({
        deleteSession: (id: string) => {
          deletedId = id;
          return Promise.resolve();
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

      const result = await service.handleLogout("sess-abc");

      expect(result).toEqual({ success: true });
      expect(deletedId).toBe("sess-abc");
    });
  });

  // ── getSessionStatus ───────────────────────────────────────────────────

  describe("getSessionStatus()", () => {
    it("returns authenticated:true when authMode is none", async () => {
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("none"),
        new RateLimiter(),
      );

      const result = await service.getSessionStatus(null);
      expect(result).toEqual({ authenticated: true, authMode: "none" });
    });

    it("returns authenticated:true with resetAuthActive when RESET_AUTH is true", async () => {
      Deno.env.set("RESET_AUTH", "true");
      try {
        service = new AuthService(
          mockDb,
          "test-key",
          createMockLogger(),
          createMockOidcService(),
          createMockConfigService("local"),
          new RateLimiter(),
        );

        const result = await service.getSessionStatus(null);
        expect(result).toEqual({
          authenticated: true,
          authMode: "local",
          resetAuthActive: true,
        });
      } finally {
        Deno.env.delete("RESET_AUTH");
      }
    });

    it("returns authenticated:true when session is valid", async () => {
      const nowSecs = Math.floor(Date.now() / 1000);
      mockDb = createMockDb({
        getSession: () =>
          Promise.resolve({
            id: "sess-abc",
            authType: "local",
            identifier: "admin",
            email: null,
            createdAt: nowSecs,
            expiresAt: nowSecs + 3600,
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

      const result = await service.getSessionStatus("sess-abc");
      expect(result).toEqual({
        authenticated: true,
        authMode: "local",
        username: "admin",
      });
    });

    it("returns authenticated:false when session is invalid", async () => {
      mockDb = createMockDb({
        getSession: () => Promise.resolve(null),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("local"),
        new RateLimiter(),
      );

      const result = await service.getSessionStatus("expired-sess");
      expect(result).toEqual({ authenticated: false, authMode: "local" });
    });

    it("returns authenticated:false when no sessionId present", async () => {
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService("oidc"),
        new RateLimiter(),
      );

      const result = await service.getSessionStatus(null);
      expect(result).toEqual({ authenticated: false, authMode: "oidc" });
    });
  });

  // ── handleChangePassword ───────────────────────────────────────────────

  describe("handleChangePassword()", () => {
    it("throws UNAUTHORIZED when no sessionId", async () => {
      try {
        await service.handleChangePassword("old", "newpass123", null);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("UNAUTHORIZED");
        expect((err as AuthError).message).toBe("No active session");
      }
    });

    it("delegates to changePassword and returns success", async () => {
      const passwordHash = await service.hashPassword("old-password");
      mockDb = createMockDb({
        getSession: (id: string) =>
          Promise.resolve({
            id,
            authType: "local",
            identifier: "admin",
            email: null,
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        getLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        updateLocalUserPassword: () => Promise.resolve(),
        deleteSessionsExcept: () => Promise.resolve(),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const result = await service.handleChangePassword(
        "old-password",
        "new-password-123",
        "sess-abc",
      );
      expect(result).toEqual({ success: true });
    });
  });

  // ── handleChangeMode ───────────────────────────────────────────────────

  describe("handleChangeMode()", () => {
    it("returns success and sets cookie when switching to local", async () => {
      mockDb = createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        createLocalUser: () => Promise.resolve({}),
        createSession: (input: unknown) => Promise.resolve(input),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const responseHeaders = new Headers();
      const result = await service.handleChangeMode(
        {
          newMode: "local",
          localConfig: { username: "admin", password: "password123" },
        },
        responseHeaders,
        false,
      );

      expect(result).toEqual({ success: true });
      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("session_id=");
    });

    it("returns success with no cookie when switching to none", async () => {
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

      const responseHeaders = new Headers();
      const result = await service.handleChangeMode(
        { newMode: "none" },
        responseHeaders,
        false,
      );

      expect(result).toEqual({ success: true });
      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toBeNull();
    });
  });

  // ── activateWizardOidc ───────────────────────────────────────────────

  describe("buildSessionCookie()", () => {
    it("builds a session cookie without Secure flag for HTTP", () => {
      const cookie = buildSessionCookie("test-id", false);
      expect(cookie).toBe(
        "session_id=test-id; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000",
      );
    });

    it("builds a session cookie with Secure flag for HTTPS", () => {
      const cookie = buildSessionCookie("test-id", true);
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("session_id=test-id");
    });
  });

  describe("buildClearCookie()", () => {
    it("builds a clear cookie with Max-Age=0", () => {
      const cookie = buildClearCookie(false);
      expect(cookie).toContain("session_id=");
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).not.toContain("Secure");
    });

    it("includes Secure flag for HTTPS", () => {
      const cookie = buildClearCookie(true);
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("Max-Age=0");
    });
  });
});

// ── Handler cookie tests (no FakeTime) ─────────────────────────────────
// These tests run without FakeTime to ensure coverage of responseHeaders.append
// lines that FakeTime's timer replacement can interfere with.
describe("AuthService handler cookie paths (no FakeTime)", () => {
  it("handleLogin sets session cookie with isHttps undefined (fallback)", async () => {
    const svc = new AuthService(
      createMockDb({
        getLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "admin",
            passwordHash: "precomputed",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        createSession: (input: unknown) => Promise.resolve(input),
        deleteExpiredSessions: () => Promise.resolve(),
      }),
      null,
      createMockLogger(),
      createMockOidcService(),
      createMockConfigService(),
      new RateLimiter(),
    );

    // Override verifyPassword to bypass argon2
    svc.verifyPassword = () => Promise.resolve(true);

    const responseHeaders = new Headers();
    // Pass responseHeaders but omit isHttps (triggers ?? false fallback)
    const result = await svc.handleLogin(
      "admin",
      "any",
      "127.0.0.1",
      responseHeaders,
    );

    expect(result).toEqual({ success: true });
    const cookie = responseHeaders.get("Set-Cookie");
    expect(cookie).toContain("session_id=");
    expect(cookie).not.toContain("Secure");
  });

  it("handleLogout sets clear cookie with isHttps undefined (fallback)", async () => {
    const svc = new AuthService(
      createMockDb(),
      null,
      createMockLogger(),
      createMockOidcService(),
      createMockConfigService(),
      new RateLimiter(),
    );

    const responseHeaders = new Headers();
    // Pass responseHeaders but omit isHttps (triggers ?? false fallback)
    const result = await svc.handleLogout("sess-1", responseHeaders);

    expect(result).toEqual({ success: true });
    const cookie = responseHeaders.get("Set-Cookie");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).not.toContain("Secure");
  });

  it("handleChangeMode sets session cookie with isHttps undefined (fallback)", async () => {
    const svc = new AuthService(
      createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        createLocalUser: () => Promise.resolve({}),
        createSession: (input: unknown) => Promise.resolve(input),
      }),
      null,
      createMockLogger(),
      createMockOidcService(),
      createMockConfigService(),
      new RateLimiter(),
    );

    // Override hashPassword to bypass argon2
    svc.hashPassword = () => Promise.resolve("$argon2id$fake-hash");

    const responseHeaders = new Headers();
    // Pass responseHeaders but omit isHttps (triggers ?? false fallback)
    const result = await svc.handleChangeMode(
      {
        newMode: "local",
        localConfig: { username: "admin", password: "password123" },
      },
      responseHeaders,
    );

    expect(result).toEqual({ success: true });
    const cookie = responseHeaders.get("Set-Cookie");
    expect(cookie).toContain("session_id=");
    expect(cookie).not.toContain("Secure");
  });

  it("handleChangeMode without responseHeaders when session created", async () => {
    const svc = new AuthService(
      createMockDb({
        deleteAllSessions: () => Promise.resolve(),
        createLocalUser: () => Promise.resolve({}),
        createSession: (input: unknown) => Promise.resolve(input),
      }),
      null,
      createMockLogger(),
      createMockOidcService(),
      createMockConfigService(),
      new RateLimiter(),
    );

    // Override hashPassword to bypass argon2
    svc.hashPassword = () => Promise.resolve("$argon2id$fake-hash");

    // No responseHeaders — covers sessionId truthy + responseHeaders falsy branch
    const result = await svc.handleChangeMode({
      newMode: "local",
      localConfig: { username: "admin", password: "password123" },
    });

    expect(result).toEqual({ success: true });
  });
});
