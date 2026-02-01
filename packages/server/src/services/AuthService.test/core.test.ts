import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
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

  // ── hashPassword / verifyPassword ────────────────────────────────────

  describe("hashPassword()", () => {
    it("returns an argon2id hash string", async () => {
      const hashed = await service.hashPassword("my-password");
      expect(hashed).toMatch(/^\$argon2id\$/);
    });

    it("produces different hashes for the same password (salted)", async () => {
      const h1 = await service.hashPassword("same");
      const h2 = await service.hashPassword("same");
      expect(h1).not.toBe(h2);
    });
  });

  describe("verifyPassword()", () => {
    it("returns true for correct password", async () => {
      const hashed = await service.hashPassword("correct");
      const result = await service.verifyPassword("correct", hashed);
      expect(result).toBe(true);
    });

    it("returns false for wrong password", async () => {
      const hashed = await service.hashPassword("correct");
      const result = await service.verifyPassword("wrong", hashed);
      expect(result).toBe(false);
    });
  });

  // ── createSession ────────────────────────────────────────────────────

  describe("createSession()", () => {
    it("creates a session with correct fields and returns session ID", async () => {
      let capturedInput: Record<string, unknown> = {};
      mockDb = createMockDb({
        createSession: (input: unknown) => {
          capturedInput = input as Record<string, unknown>;
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

      const id = await service.createSession("local", "admin");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);

      // Verify the input passed to db
      expect(capturedInput.authType).toBe("local");
      expect(capturedInput.identifier).toBe("admin");
      expect(capturedInput.email).toBeNull();
      expect(typeof capturedInput.createdAt).toBe("number");
      expect(typeof capturedInput.expiresAt).toBe("number");
      // TTL should be 30 days
      const ttl = (capturedInput.expiresAt as number) -
        (capturedInput.createdAt as number);
      expect(ttl).toBe(30 * 24 * 60 * 60);
    });

    it("passes email when provided", async () => {
      let capturedInput: Record<string, unknown> = {};
      mockDb = createMockDb({
        createSession: (input: unknown) => {
          capturedInput = input as Record<string, unknown>;
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

      await service.createSession("oidc", "sub-123", "user@example.com");
      expect(capturedInput.email).toBe("user@example.com");
      expect(capturedInput.authType).toBe("oidc");
      expect(capturedInput.identifier).toBe("sub-123");
    });

    it("uses crypto.randomUUID() for session ID", async () => {
      const ids = new Set<string>();
      mockDb = createMockDb({
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

      await Array.from({ length: 5 }).reduce(async (prev) => {
        await prev;
        ids.add(await service.createSession("local", "admin"));
      }, Promise.resolve());
      // All IDs should be unique UUIDs
      expect(ids.size).toBe(5);
      [...ids].forEach((id) => {
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      });
    });
  });

  // ── validateSession ──────────────────────────────────────────────────

  describe("validateSession()", () => {
    it("returns session when valid and not expired", async () => {
      const nowSecs = Math.floor(Date.now() / 1000);
      const session = {
        id: "sess-1",
        authType: "local",
        identifier: "admin",
        email: null,
        createdAt: nowSecs,
        expiresAt: nowSecs + 3600,
      };
      mockDb = createMockDb({
        getSession: () => Promise.resolve(session),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const result = await service.validateSession("sess-1");
      expect(result).toEqual(session);
    });

    it("returns null when session not found", async () => {
      mockDb = createMockDb({
        getSession: () => Promise.resolve(null),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const result = await service.validateSession("nonexistent");
      expect(result).toBeNull();
    });

    it("returns null when session is expired", async () => {
      const nowSecs = Math.floor(Date.now() / 1000);
      const session = {
        id: "sess-1",
        authType: "local",
        identifier: "admin",
        email: null,
        createdAt: nowSecs - 7200,
        expiresAt: nowSecs - 3600, // expired 1 hour ago
      };
      mockDb = createMockDb({
        getSession: () => Promise.resolve(session),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const result = await service.validateSession("sess-1");
      expect(result).toBeNull();
    });

    it("returns null when session expires at exactly now", async () => {
      const nowSecs = Math.floor(Date.now() / 1000);
      const session = {
        id: "sess-1",
        authType: "local",
        identifier: "admin",
        email: null,
        createdAt: nowSecs - 3600,
        expiresAt: nowSecs, // expires right now
      };
      mockDb = createMockDb({
        getSession: () => Promise.resolve(session),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      const result = await service.validateSession("sess-1");
      expect(result).toBeNull();
    });
  });

  // ── deleteSession ────────────────────────────────────────────────────

  describe("deleteSession()", () => {
    it("delegates to db.deleteSession", async () => {
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

      await service.deleteSession("sess-to-delete");
      expect(deletedId).toBe("sess-to-delete");
    });
  });

  // ── login ────────────────────────────────────────────────────────────

  describe("login()", () => {
    it("returns session ID on valid credentials", async () => {
      const passwordHash = await service.hashPassword("correct-password");
      let sessionCreated = false;
      let expiredCleaned = false;

      mockDb = createMockDb({
        getLocalUser: (username: string) => {
          if (username === "admin") {
            return Promise.resolve({
              id: 1,
              username: "admin",
              passwordHash,
              createdAt: "2026-01-01",
              updatedAt: "2026-01-01",
            });
          }
          return Promise.resolve(null);
        },
        createSession: (input: unknown) => {
          sessionCreated = true;
          return Promise.resolve(input);
        },
        deleteExpiredSessions: () => {
          expiredCleaned = true;
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

      const sessionId = await service.login("admin", "correct-password");
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
      expect(sessionCreated).toBe(true);
      expect(expiredCleaned).toBe(true);
    });

    it("throws on unknown username (no user enumeration)", async () => {
      mockDb = createMockDb({
        getLocalUser: () => Promise.resolve(null),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      await expect(service.login("nobody", "password")).rejects.toThrow(
        "Invalid credentials",
      );
    });

    it("throws on wrong password (no user enumeration)", async () => {
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
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      await expect(service.login("admin", "wrong")).rejects.toThrow(
        "Invalid credentials",
      );
    });

    it("uses same error message for missing user and wrong password", async () => {
      const passwordHash = await service.hashPassword("correct");

      // Test missing user
      mockDb = createMockDb({
        getLocalUser: () => Promise.resolve(null),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );
      let missingUserError = "";
      try {
        await service.login("nobody", "password");
      } catch (e) {
        missingUserError = (e as Error).message;
      }

      // Test wrong password
      mockDb = createMockDb({
        getLocalUser: () =>
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
        createMockConfigService(),
        new RateLimiter(),
      );
      let wrongPasswordError = "";
      try {
        await service.login("admin", "wrong");
      } catch (e) {
        wrongPasswordError = (e as Error).message;
      }

      expect(missingUserError).toBe(wrongPasswordError);
      expect(missingUserError).toBe("Invalid credentials");
    });

    it("deletes expired sessions on successful login (lazy cleanup)", async () => {
      const passwordHash = await service.hashPassword("pass");
      let cleanupCalled = false;

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
        deleteExpiredSessions: () => {
          cleanupCalled = true;
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

      await service.login("admin", "pass");
      expect(cleanupCalled).toBe(true);
    });

    it("does not cleanup expired sessions on failed login", async () => {
      let cleanupCalled = false;

      mockDb = createMockDb({
        getLocalUser: () => Promise.resolve(null),
        deleteExpiredSessions: () => {
          cleanupCalled = true;
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

      try {
        await service.login("nobody", "pass");
      } catch (error) {
        // expected
        expect(error).toBeDefined();
      }
      expect(cleanupCalled).toBe(false);
    });

    it("creates session with authType 'local' and username as identifier", async () => {
      const passwordHash = await service.hashPassword("pass");
      let capturedInput: Record<string, unknown> = {};

      mockDb = createMockDb({
        getLocalUser: () =>
          Promise.resolve({
            id: 1,
            username: "myuser",
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        createSession: (input: unknown) => {
          capturedInput = input as Record<string, unknown>;
          return Promise.resolve(input);
        },
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

      await service.login("myuser", "pass");
      expect(capturedInput.authType).toBe("local");
      expect(capturedInput.identifier).toBe("myuser");
    });
  });

  // ── logout ───────────────────────────────────────────────────────────

  describe("logout()", () => {
    it("deletes the session", async () => {
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

      await service.logout("sess-123");
      expect(deletedId).toBe("sess-123");
    });
  });

  // ── changePassword ──────────────────────────────────────────────────

  describe("changePassword()", () => {
    it("updates password and invalidates other sessions on valid change", async () => {
      const passwordHash = await service.hashPassword("old-password");
      let updatedHash: string | null = null;
      let exceptId: string | null = null;

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
        getLocalUser: (username: string) =>
          Promise.resolve({
            id: 1,
            username,
            passwordHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        updateLocalUserPassword: (_u: string, h: string) => {
          updatedHash = h;
          return Promise.resolve();
        },
        deleteSessionsExcept: (id: string) => {
          exceptId = id;
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

      await service.changePassword(
        "old-password",
        "new-password-123",
        "current-sess",
      );
      expect(updatedHash).not.toBeNull();
      expect(updatedHash).toMatch(/^\$argon2id\$/);
      expect(exceptId).toBe("current-sess");
    });

    it("throws UNAUTHORIZED when current password is wrong", async () => {
      const passwordHash = await service.hashPassword("correct-password");
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
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      try {
        await service.changePassword(
          "wrong-password",
          "new-password-123",
          "sess-1",
        );
        expect(true).toBe(false); // should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("UNAUTHORIZED");
        expect((err as AuthError).message).toBe("Invalid credentials");
      }
    });

    it("throws BAD_REQUEST when new password is empty", async () => {
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
        await service.changePassword("old", "", "sess-1");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("BAD_REQUEST");
        expect((err as AuthError).message).toContain("at least 1 character");
      }
    });

    it("throws UNAUTHORIZED when session is not found", async () => {
      mockDb = createMockDb({
        getSession: () => Promise.resolve(null),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      try {
        await service.changePassword(
          "old-password",
          "new-password-123",
          "nonexistent",
        );
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("UNAUTHORIZED");
      }
    });

    it("throws UNAUTHORIZED when user not found for session identifier", async () => {
      mockDb = createMockDb({
        getSession: (id: string) =>
          Promise.resolve({
            id,
            authType: "local",
            identifier: "ghost",
            email: null,
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        getLocalUser: () => Promise.resolve(null),
      });
      service = new AuthService(
        mockDb,
        "test-key",
        createMockLogger(),
        createMockOidcService(),
        createMockConfigService(),
        new RateLimiter(),
      );

      try {
        await service.changePassword(
          "old-password",
          "new-password-123",
          "sess-1",
        );
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).code).toBe("UNAUTHORIZED");
      }
    });

    it("new password can be verified after change", async () => {
      const oldHash = await service.hashPassword("old-password");
      let storedHash = oldHash;

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
            passwordHash: oldHash,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }),
        updateLocalUserPassword: (_u: string, h: string) => {
          storedHash = h;
          return Promise.resolve();
        },
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

      await service.changePassword(
        "old-password",
        "new-password-123",
        "sess-1",
      );

      // Verify the new hash works
      const valid = await service.verifyPassword(
        "new-password-123",
        storedHash,
      );
      expect(valid).toBe(true);

      // Verify old password no longer works
      const invalid = await service.verifyPassword("old-password", storedHash);
      expect(invalid).toBe(false);
    });
  });

  // ── changeMode ────────────────────────────────────────────────────────
});
