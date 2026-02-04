import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { authRouter } from "./auth.ts";
import { AuthError } from "../../services/AuthService.ts";
import {
  buildClearCookie,
  buildSessionCookie,
} from "../../services/AuthService.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Auth tRPC Router", () => {
  const createCaller = createCallerFactory(authRouter);

  const makeMockAuthService = (overrides: Record<string, unknown> = {}) => ({
    handleLogin: (
      _username: string,
      _password: string,
      _clientIp: string,
      responseHeaders?: Headers,
      isHttps?: boolean,
    ) => {
      responseHeaders?.append(
        "Set-Cookie",
        buildSessionCookie("session-uuid-123", isHttps ?? false),
      );
      return Promise.resolve({ success: true as const });
    },
    handleLogout: (
      _sessionId: string | null | undefined,
      responseHeaders?: Headers,
      isHttps?: boolean,
    ) => {
      responseHeaders?.append(
        "Set-Cookie",
        buildClearCookie(isHttps ?? false),
      );
      return Promise.resolve({ success: true as const });
    },
    getSessionStatus: () =>
      Promise.resolve({ authenticated: true, authMode: "none" as const }),
    handleChangePassword: () => Promise.resolve({ success: true as const }),
    handleChangeMode: () => Promise.resolve({ success: true as const }),
    handleUpdateOidcConfig: () => Promise.resolve({ success: true as const }),
    getOidcConfig: () => Promise.resolve(null),
    ...overrides,
  });

  const makeCtx = (overrides: Record<string, unknown> = {}): TrpcContext => {
    const responseHeaders = new Headers();
    return throwingMock<TrpcContext>("TrpcContext", {
      authService: makeMockAuthService() as never,
      responseHeaders,
      clientIp: "127.0.0.1",
      isHttps: false,
      sessionId: "session-uuid-123",
      ...overrides,
    } as Partial<TrpcContext>);
  };

  // ── auth.login ──────────────────────────────────────────────────────────

  describe("auth.login", () => {
    it("returns success and sets session cookie on valid credentials", async () => {
      const responseHeaders = new Headers();
      const ctx = makeCtx({ responseHeaders });
      const caller = createCaller(ctx);

      const result = await caller.login({
        username: "admin",
        password: "password123",
      });

      expect(result).toEqual({ success: true });
      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("session_id=session-uuid-123");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=2592000");
    });

    it("sets Secure flag when isHttps is true", async () => {
      const responseHeaders = new Headers();
      const ctx = makeCtx({ responseHeaders, isHttps: true });
      const caller = createCaller(ctx);

      await caller.login({ username: "admin", password: "password123" });

      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("Secure");
    });

    it("omits Secure flag when isHttps is false", async () => {
      const responseHeaders = new Headers();
      const ctx = makeCtx({ responseHeaders, isHttps: false });
      const caller = createCaller(ctx);

      await caller.login({ username: "admin", password: "password123" });

      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).not.toContain("Secure");
    });

    it("throws UNAUTHORIZED on invalid credentials", async () => {
      const authService = makeMockAuthService({
        handleLogin: () => Promise.reject(new Error("Invalid credentials")),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      await expect(caller.login({ username: "admin", password: "wrong" }))
        .rejects.toMatchObject({
          code: "UNAUTHORIZED",
          message: "invalid_credentials",
        });
    });

    it("throws TOO_MANY_REQUESTS when rate limited", async () => {
      const authService = makeMockAuthService({
        handleLogin: () =>
          Promise.reject(
            new AuthError(
              JSON.stringify({ retryAfter: 60 }),
              "TOO_MANY_REQUESTS",
            ),
          ),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      await expect(
        caller.login({ username: "admin", password: "password123" }),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });
  });

  // ── auth.logout ─────────────────────────────────────────────────────────

  describe("auth.logout", () => {
    it("calls authService.handleLogout and clears session cookie", async () => {
      let capturedSessionId: string | null | undefined;
      const authService = makeMockAuthService({
        handleLogout: (
          sessionId: string | null | undefined,
          responseHeaders?: Headers,
          isHttps?: boolean,
        ) => {
          capturedSessionId = sessionId;
          responseHeaders?.append(
            "Set-Cookie",
            buildClearCookie(isHttps ?? false),
          );
          return Promise.resolve({ success: true as const });
        },
      });
      const responseHeaders = new Headers();
      const ctx = makeCtx({
        authService,
        responseHeaders,
        sessionId: "sess-abc",
      });
      const caller = createCaller(ctx);

      const result = await caller.logout();

      expect(result).toEqual({ success: true });
      expect(capturedSessionId).toBe("sess-abc");
      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("session_id=");
      expect(cookie).toContain("Max-Age=0");
    });

    it("passes null sessionId when no session is present", async () => {
      let capturedSessionId: string | null | undefined = "not-set";
      const authService = makeMockAuthService({
        handleLogout: (
          sessionId: string | null | undefined,
          responseHeaders?: Headers,
          isHttps?: boolean,
        ) => {
          capturedSessionId = sessionId;
          responseHeaders?.append(
            "Set-Cookie",
            buildClearCookie(isHttps ?? false),
          );
          return Promise.resolve({ success: true as const });
        },
      });
      const responseHeaders = new Headers();
      const ctx = makeCtx({
        authService,
        responseHeaders,
        sessionId: null,
      });
      const caller = createCaller(ctx);

      const result = await caller.logout();

      expect(result).toEqual({ success: true });
      expect(capturedSessionId).toBeNull();
      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("Max-Age=0");
    });

    it("sets Secure flag on clear cookie when isHttps", async () => {
      const responseHeaders = new Headers();
      const ctx = makeCtx({ responseHeaders, isHttps: true });
      const caller = createCaller(ctx);

      await caller.logout();

      const cookie = responseHeaders.get("Set-Cookie");
      expect(cookie).toContain("Secure");
    });
  });

  // ── auth.session ────────────────────────────────────────────────────────

  describe("auth.session", () => {
    it("returns authenticated:true when authMode is none", async () => {
      const authService = makeMockAuthService({
        getSessionStatus: () =>
          Promise.resolve({ authenticated: true, authMode: "none" }),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      const result = await caller.session();

      expect(result).toEqual({ authenticated: true, authMode: "none" });
    });

    it("returns authenticated:true with resetAuthActive when RESET_AUTH is true", async () => {
      const authService = makeMockAuthService({
        getSessionStatus: () =>
          Promise.resolve({
            authenticated: true,
            authMode: "local",
            resetAuthActive: true,
          }),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      const result = await caller.session();

      expect(result).toEqual({
        authenticated: true,
        authMode: "local",
        resetAuthActive: true,
      });
    });

    it("returns authenticated:true when session is valid", async () => {
      const authService = makeMockAuthService({
        getSessionStatus: () =>
          Promise.resolve({ authenticated: true, authMode: "local" }),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      const result = await caller.session();

      expect(result).toEqual({ authenticated: true, authMode: "local" });
    });

    it("returns authenticated:false when session is invalid", async () => {
      const authService = makeMockAuthService({
        getSessionStatus: () =>
          Promise.resolve({ authenticated: false, authMode: "local" }),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      const result = await caller.session();

      expect(result).toEqual({ authenticated: false, authMode: "local" });
    });

    it("returns authenticated:false when no sessionId present", async () => {
      const authService = makeMockAuthService({
        getSessionStatus: () =>
          Promise.resolve({ authenticated: false, authMode: "oidc" }),
      });
      const ctx = makeCtx({ authService, sessionId: null });
      const caller = createCaller(ctx);

      const result = await caller.session();

      expect(result).toEqual({ authenticated: false, authMode: "oidc" });
    });

    it("returns correct authMode for oidc", async () => {
      const authService = makeMockAuthService({
        getSessionStatus: () =>
          Promise.resolve({ authenticated: true, authMode: "oidc" }),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      const result = await caller.session();

      expect(result).toEqual({ authenticated: true, authMode: "oidc" });
    });
  });

  // ── auth.changePassword ─────────────────────────────────────────────────

  describe("auth.changePassword", () => {
    it("delegates to authService.handleChangePassword on success", async () => {
      let capturedArgs: unknown[] = [];
      const authService = makeMockAuthService({
        handleChangePassword: (...args: unknown[]) => {
          capturedArgs = args;
          return Promise.resolve({ success: true as const });
        },
      });
      const ctx = makeCtx({ authService, sessionId: "sess-abc" });
      const caller = createCaller(ctx);

      const result = await caller.changePassword({
        currentPassword: "oldpass123",
        newPassword: "newpass456",
      });

      expect(result).toEqual({ success: true });
      expect(capturedArgs).toEqual(["oldpass123", "newpass456", "sess-abc"]);
    });

    it("throws UNAUTHORIZED when AuthService throws AuthError UNAUTHORIZED for invalid credentials", async () => {
      const authService = makeMockAuthService({
        handleChangePassword: () =>
          Promise.reject(
            new AuthError("Invalid credentials", "UNAUTHORIZED"),
          ),
      });
      const ctx = makeCtx({ authService, sessionId: "sess-abc" });
      const caller = createCaller(ctx);

      await expect(
        caller.changePassword({
          currentPassword: "wrong",
          newPassword: "newpass456",
        }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    });

    it("rejects empty newPassword via Zod", async () => {
      const ctx = makeCtx();
      const caller = createCaller(ctx);

      await expect(
        caller.changePassword({
          currentPassword: "oldpass123",
          newPassword: "",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── auth.changeMode ─────────────────────────────────────────────────────

  describe("auth.changeMode", () => {
    it("delegates to authService.handleChangeMode on success", async () => {
      let capturedArgs: unknown[] = [];
      const authService = makeMockAuthService({
        handleChangeMode: (...args: unknown[]) => {
          capturedArgs = args;
          return Promise.resolve({ success: true as const });
        },
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      const result = await caller.changeMode({
        newMode: "local",
        localConfig: { username: "admin", password: "password123" },
      });

      expect(result).toEqual({ success: true });
      // First arg is the input, second is responseHeaders, third is isHttps
      expect(capturedArgs[0]).toEqual({
        newMode: "local",
        localConfig: { username: "admin", password: "password123" },
      });
    });

    it("passes currentPassword for re-auth from local mode", async () => {
      let capturedInput: unknown;
      const authService = makeMockAuthService({
        handleChangeMode: (input: unknown) => {
          capturedInput = input;
          return Promise.resolve({ success: true as const });
        },
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      await caller.changeMode({
        newMode: "none",
        currentPassword: "myoldpass",
      });

      expect(capturedInput).toEqual({
        newMode: "none",
        currentPassword: "myoldpass",
      });
    });

    it("passes oidcConfig when switching to oidc", async () => {
      let capturedInput: unknown;
      const authService = makeMockAuthService({
        handleChangeMode: (input: unknown) => {
          capturedInput = input;
          return Promise.resolve({ success: true as const });
        },
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      await caller.changeMode({
        newMode: "oidc",
        oidcConfig: {
          issuerUrl: "https://auth.example.com",
          clientId: "my-client",
          clientSecret: "secret123",
          baseUrl: "https://chargeha.local",
        },
      });

      expect((capturedInput as { newMode: string }).newMode).toBe("oidc");
      expect(
        (capturedInput as { oidcConfig: { issuerUrl: string } }).oidcConfig
          .issuerUrl,
      ).toBe("https://auth.example.com");
    });

    it("throws UNAUTHORIZED when AuthService throws AuthError UNAUTHORIZED", async () => {
      const authService = makeMockAuthService({
        handleChangeMode: () =>
          Promise.reject(
            new AuthError("Invalid credentials", "UNAUTHORIZED"),
          ),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      await expect(
        caller.changeMode({ newMode: "none", currentPassword: "wrong" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("throws BAD_REQUEST when AuthService throws AuthError BAD_REQUEST", async () => {
      const authService = makeMockAuthService({
        handleChangeMode: () =>
          Promise.reject(new AuthError("invalid_config", "BAD_REQUEST")),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      await expect(
        caller.changeMode({
          newMode: "oidc",
          oidcConfig: {
            issuerUrl: "https://bad.example.com",
            clientId: "c",
            clientSecret: "s",
            baseUrl: "https://chargeha.local",
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("validates newMode is one of none, local, oidc", async () => {
      const ctx = makeCtx();
      const caller = createCaller(ctx);

      await expect(
        caller.changeMode({ newMode: "invalid" as "none" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── auth.updateOidcConfig ──────────────────────────────────────────────

  describe("auth.updateOidcConfig", () => {
    it("delegates to authService.handleUpdateOidcConfig on success", async () => {
      let capturedInput: unknown;
      const authService = makeMockAuthService({
        handleUpdateOidcConfig: (input: unknown) => {
          capturedInput = input;
          return Promise.resolve({ success: true as const });
        },
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      const result = await caller.updateOidcConfig({
        issuerUrl: "https://auth.example.com",
        clientId: "my-client",
        clientSecret: "secret123",
        baseUrl: "https://chargeha.local",
      });

      expect(result).toEqual({ success: true });
      expect(capturedInput).toEqual({
        issuerUrl: "https://auth.example.com",
        clientId: "my-client",
        clientSecret: "secret123",
        baseUrl: "https://chargeha.local",
      });
    });

    it("throws BAD_REQUEST when service throws AuthError BAD_REQUEST", async () => {
      const authService = makeMockAuthService({
        handleUpdateOidcConfig: () =>
          Promise.reject(new AuthError("Discovery failed", "BAD_REQUEST")),
      });
      const ctx = makeCtx({ authService });
      const caller = createCaller(ctx);

      await expect(
        caller.updateOidcConfig({
          issuerUrl: "https://bad.example.com",
          clientId: "c",
          clientSecret: "s",
          baseUrl: "https://chargeha.local",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects empty issuerUrl via Zod", async () => {
      const ctx = makeCtx();
      const caller = createCaller(ctx);

      await expect(
        caller.updateOidcConfig({
          issuerUrl: "",
          clientId: "c",
          clientSecret: "s",
          baseUrl: "https://chargeha.local",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
