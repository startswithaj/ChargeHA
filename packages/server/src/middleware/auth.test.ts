import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import { hstsMiddleware, isHttps } from "./auth.ts";
import { makeSession, setupAuthApp } from "../test-helpers/authHarness.ts";

// ── isHttps ─────────────────────────────────────────────────────────────────

describe("isHttps()", () => {
  it("returns true when X-Forwarded-Proto is https", () => {
    const req = new Request("http://localhost/test", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    expect(isHttps(req)).toBe(true);
  });

  it("returns false when X-Forwarded-Proto is http", () => {
    const req = new Request("http://localhost/test", {
      headers: { "X-Forwarded-Proto": "http" },
    });
    expect(isHttps(req)).toBe(false);
  });

  it("returns true when URL scheme is https", () => {
    const req = new Request("https://example.com/test");
    expect(isHttps(req)).toBe(true);
  });

  it("returns false for plain http with no X-Forwarded-Proto", () => {
    const req = new Request("http://localhost/test");
    expect(isHttps(req)).toBe(false);
  });
});

// ── hstsMiddleware ──────────────────────────────────────────────────────────

describe("hstsMiddleware()", () => {
  it("adds HSTS header when request is over HTTPS", async () => {
    const app = new Hono();
    app.use(hstsMiddleware());
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test", {
      headers: { "X-Forwarded-Proto": "https" },
    });

    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("does not add HSTS header on plain HTTP", async () => {
    const app = new Hono();
    app.use(hstsMiddleware());
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });
});

// ── createAuthMiddleware ────────────────────────────────────────────────────

describe("createAuthMiddleware()", () => {
  beforeEach(() => {
    Deno.env.delete("RESET_AUTH");
  });

  describe("auth_mode === 'none'", () => {
    it("skips auth and passes through", async () => {
      const { app } = setupAuthApp({ authMode: "none" });

      const res = await app.request("/protected");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });

  describe("RESET_AUTH env var", () => {
    it("skips auth and sets X-Auth-Warning header", async () => {
      Deno.env.set("RESET_AUTH", "true");
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/protected");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Auth-Warning")).toBe("disabled");
    });

    it("does not skip when RESET_AUTH is not 'true'", async () => {
      Deno.env.set("RESET_AUTH", "false");
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/protected");
      expect(res.status).toBe(401);
    });
  });

  describe("exempt paths", () => {
    it("allows GET /health without auth", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/health");
      expect(res.status).toBe(200);
    });

    it("allows GET /auth/oidc/login without auth", async () => {
      const { app } = setupAuthApp({ authMode: "oidc" });

      const res = await app.request("/auth/oidc/login");
      expect(res.status).toBe(200);
    });

    it("allows GET /auth/oidc/callback without auth", async () => {
      const { app } = setupAuthApp({ authMode: "oidc" });

      const res = await app.request("/auth/oidc/callback");
      expect(res.status).toBe(200);
    });

    it("allows GET /.well-known/* without auth", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/.well-known/openid-configuration");
      expect(res.status).toBe(200);
    });

    it("allows /trpc/auth.login without auth", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/trpc/auth.login", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("allows /trpc/auth.session without auth", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/trpc/auth.session");
      expect(res.status).toBe(200);
    });

    it("does not exempt non-auth tRPC paths", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/trpc/config.get");
      expect(res.status).toBe(401);
    });

    it("allows static .js assets without auth", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/assets/app.js");
      expect(res.status).toBe(200);
    });

    it("allows static .css assets without auth", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/assets/style.css");
      expect(res.status).toBe(200);
    });

    it("allows static .svg assets without auth", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/logo.svg");
      expect(res.status).toBe(200);
    });

    it("does not exempt /health for POST", async () => {
      // /health is only exempt for GET — POST should require auth.
      const { app } = setupAuthApp({
        authMode: "local",
        extraRoutes: (a) => {
          a.post("/health", (c) => c.json({ healthy: true }));
        },
      });

      const res = await app.request("/health", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  describe("session validation", () => {
    it("allows request with valid session cookie", async () => {
      const session = makeSession();
      const { app } = setupAuthApp({
        authMode: "local",
        validateSession: (id) => {
          expect(id).toBe("sess-abc");
          return Promise.resolve(session);
        },
      });

      const res = await app.request("/protected", {
        headers: { Cookie: "session_id=sess-abc" },
      });
      expect(res.status).toBe(200);
    });

    it("returns 401 when session cookie is missing", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/protected");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns 401 when session is expired/invalid", async () => {
      const { app } = setupAuthApp({
        authMode: "local",
        validateSession: () => Promise.resolve(null),
      });

      const res = await app.request("/protected", {
        headers: { Cookie: "session_id=expired-sess" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when session cookie has wrong name", async () => {
      const { app } = setupAuthApp({ authMode: "local" });

      const res = await app.request("/protected", {
        headers: { Cookie: "other_cookie=sess-abc" },
      });
      expect(res.status).toBe(401);
    });

    it("parses session_id from multiple cookies", async () => {
      const session = makeSession();
      const { app } = setupAuthApp({
        authMode: "local",
        validateSession: (id) => {
          expect(id).toBe("sess-multi");
          return Promise.resolve(session);
        },
      });

      const res = await app.request("/protected", {
        headers: { Cookie: "other=val; session_id=sess-multi; another=val2" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("auth_mode === 'oidc'", () => {
    it("requires session for protected routes", async () => {
      const { app } = setupAuthApp({ authMode: "oidc" });

      const res = await app.request("/protected");
      expect(res.status).toBe(401);
    });

    it("allows oidc routes without session", async () => {
      const { app } = setupAuthApp({ authMode: "oidc" });

      const res = await app.request("/auth/oidc/login");
      expect(res.status).toBe(200);
    });
  });
});
