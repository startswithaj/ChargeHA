import type { MiddlewareHandler } from "hono";
import type { AuthService } from "../services/AuthService.ts";
import type { ConfigService } from "../services/ConfigService.ts";
import type { Logger } from "../lib/Logger.ts";

/** Dependencies for the auth middleware. */
export interface AuthMiddlewareDeps {
  authService: AuthService;
  configService: ConfigService;
  logger: Logger;
}

/** Paths that bypass auth checks entirely. */
const EXEMPT_PREFIXES = [
  "GET /auth/oidc/",
  "GET /.well-known/",
  "GET /health",
] as const;

/** tRPC procedure paths that bypass auth. */
const EXEMPT_TRPC_PATHS = [
  "/trpc/auth.login",
  "/trpc/auth.session",
] as const;

/** Static asset extensions that bypass auth. */
const STATIC_EXTENSIONS = [
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".map",
] as const;

/**
 * Detect whether the incoming request arrived over HTTPS.
 * Checks X-Forwarded-Proto header first (reverse proxy), then URL scheme.
 */
export function isHttps(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded === "https") return true;
  const proto = new URL(req.url).protocol;
  return proto === "https:";
}

/** Check whether a path is exempt from auth. */
function isExemptPath(method: string, path: string): boolean {
  // Check method+path prefixes
  const matchesPrefix = EXEMPT_PREFIXES.some((prefix) => {
    const [exemptMethod, exemptPath] = prefix.split(" ", 2);
    return method === exemptMethod && path.startsWith(exemptPath);
  });
  if (matchesPrefix) return true;

  // Check tRPC exempt paths (any method — tRPC uses GET for queries, POST for mutations)
  if (EXEMPT_TRPC_PATHS.some((trpcPath) => path.startsWith(trpcPath))) {
    return true;
  }

  // Check static asset extensions
  const pathWithoutQuery = path.split("?")[0];
  if (STATIC_EXTENSIONS.some((ext) => pathWithoutQuery.endsWith(ext))) {
    return true;
  }

  return false;
}

/**
 * Hono middleware that adds Strict-Transport-Security header
 * only when the request arrived over HTTPS.
 */
export function hstsMiddleware(): MiddlewareHandler {
  return async function hsts(c, next) {
    await next();
    if (isHttps(c.req.raw)) {
      // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- Hono middleware API
      c.res.headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains",
      );
    }
  };
}

/**
 * Create the session-based auth middleware.
 *
 * Check order:
 * 1. auth_mode === "none" → skip
 * 2. RESET_AUTH env var → skip + X-Auth-Warning header
 * 3. exempt path → skip
 * 4. valid session cookie → attach to context, continue
 * 5. otherwise → 401
 */
export function createAuthMiddleware(
  deps: AuthMiddlewareDeps,
): MiddlewareHandler {
  const { authService, configService, logger } = deps;

  return async function authMiddleware(c, next) {
    // 1. Check auth_mode
    const internal = await configService.getInternal();
    const authMode = internal.authMode;
    if (authMode === "none") {
      return next();
    }

    // 2. Check RESET_AUTH env var
    const resetAuth = Deno.env.get("RESET_AUTH");
    if (resetAuth === "true") {
      await next();
      // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- Hono middleware API
      c.res.headers.set("X-Auth-Warning", "disabled");
      return;
    }

    // 3. Check exempt paths
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;
    if (isExemptPath(method, path)) {
      return next();
    }

    // 4. Check session cookie
    const cookieHeader = c.req.header("Cookie");
    const sessionId = parseCookieValue(cookieHeader, "session_id");

    if (sessionId) {
      const session = await authService.validateSession(sessionId);
      if (session) {
        // Attach session to Hono context for downstream handlers
        // deno-lint-ignore custom-no-param-mutation/no-param-mutation -- Hono middleware API
        c.set("session", session);
        return next();
      }
    }

    // 5. No valid session — 401
    logger.warn(`Auth rejected: ${method} ${path}`);
    return c.json({ error: "Unauthorized" }, 401);
  };
}

/** Parse a single cookie value from a Cookie header string. */
function parseCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  const match = cookies.find((cookie) => {
    const [key] = cookie.trim().split("=");
    return key === name;
  });
  if (!match) return null;
  const [, ...rest] = match.trim().split("=");
  return rest.join("="); // handle values with '=' in them
}
