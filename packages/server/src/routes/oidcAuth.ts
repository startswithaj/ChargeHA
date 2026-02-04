import { Hono } from "hono";
import * as oauth from "oauth4webapi";
import type { AuthService } from "../services/AuthService.ts";
import type { OidcService } from "../services/OidcService.ts";
import type { Logger } from "../lib/Logger.ts";
import { isHttps } from "../middleware/auth.ts";
import { buildSessionCookie } from "../services/AuthService.ts";

/** Dependencies for OIDC routes. */
export interface OidcRouteDeps {
  authService: AuthService;
  oidcService: OidcService;
  logger: Logger;
}

/** OIDC error codes redirected to the login page. */
type OidcErrorCode =
  | "provider_denied"
  | "state_mismatch"
  | "token_exchange_failed"
  | "provider_unreachable";

/** Build a Set-Cookie header for an OIDC cookie (code_verifier or state). */
function buildOidcCookie(
  name: string,
  value: string,
  secure: boolean,
): string {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/auth/oidc/callback",
    "Max-Age=600",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Build a Set-Cookie header that clears an OIDC cookie. */
function buildClearOidcCookie(name: string, secure: boolean): string {
  const parts = [
    `${name}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/auth/oidc/callback",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
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
  return rest.join("=");
}

/** Redirect to the appropriate page with an error code based on return context. */
function errorRedirect(
  code: OidcErrorCode,
  returnContext: string | null,
): Response {
  const CONTEXT_PATHS: Record<string, string> = {
    wizard: "/wizard",
    settings: "/settings",
  };
  const base = CONTEXT_PATHS[returnContext ?? ""] ?? "/login";
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}?error=${code}` },
  });
}

/**
 * Create Hono routes for OIDC login/callback.
 * Mount at /auth/oidc in App.ts.
 */
async function buildLoginRedirect(
  oidcService: OidcRouteDeps["oidcService"],
  logger: OidcRouteDeps["logger"],
  request: Request,
  returnContext: string | null,
): Promise<Response> {
  const oidcState = await oidcService.getState();
  if (!oidcState) {
    logger.warn("OIDC login attempted but OIDC not initialized");
    return errorRedirect("provider_unreachable", returnContext);
  }
  const { server: as, client, baseUrl } = oidcState;
  if (!as.authorization_endpoint) {
    logger.warn("OIDC provider has no authorization_endpoint");
    return errorRedirect("provider_unreachable", returnContext);
  }
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = oauth.generateRandomState();
  const redirectUri = `${baseUrl}/auth/oidc/callback`;

  const authUrl = new URL(as.authorization_endpoint);
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const secure = isHttps(request);
  const headers = new Headers({ Location: authUrl.toString() });
  headers.append(
    "Set-Cookie",
    buildOidcCookie("oidc_code_verifier", codeVerifier, secure),
  );
  headers.append(
    "Set-Cookie",
    buildOidcCookie("oidc_state", state, secure),
  );
  if (returnContext) {
    headers.append(
      "Set-Cookie",
      buildOidcCookie("oidc_return", returnContext, secure),
    );
  }
  return new Response(null, { status: 302, headers });
}

function classifyOidcError(
  err: unknown,
  logger: OidcRouteDeps["logger"],
  returnContext: string | null,
): Response {
  const message = (err as Error).message || String(err);
  if (message.includes("state")) {
    logger.warn(`OIDC callback state mismatch: ${message}`);
    return errorRedirect("state_mismatch", returnContext);
  }
  if (
    err instanceof TypeError ||
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("ECONNREFUSED") ||
    message.includes("timeout")
  ) {
    logger.warn(`OIDC provider unreachable: ${message}`);
    return errorRedirect("provider_unreachable", returnContext);
  }
  logger.warn(`OIDC token exchange failed: ${message}`);
  return errorRedirect("token_exchange_failed", returnContext);
}

function buildSuccessResponse(
  sessionId: string,
  returnContext: string | null,
  secure: boolean,
): Response {
  const REDIRECT_PATHS: Record<string, string> = {
    wizard: "/wizard",
    settings: "/settings?oidc_updated=1",
  };
  const redirectTo = REDIRECT_PATHS[returnContext ?? ""] ?? "/";
  const headers = new Headers({ Location: redirectTo });
  headers.append("Set-Cookie", buildSessionCookie(sessionId, secure));
  headers.append(
    "Set-Cookie",
    buildClearOidcCookie("oidc_code_verifier", secure),
  );
  headers.append("Set-Cookie", buildClearOidcCookie("oidc_state", secure));
  headers.append("Set-Cookie", buildClearOidcCookie("oidc_return", secure));
  return new Response(null, { status: 302, headers });
}

async function processOidcCallback(
  { authService, oidcService, logger }: OidcRouteDeps,
  request: Request,
): Promise<Response> {
  const oidcState = await oidcService.getState();
  const secure = isHttps(request);
  const cookieHeader = request.headers.get("Cookie") ?? undefined;
  const returnContext = parseCookieValue(cookieHeader, "oidc_return");

  if (!oidcState) {
    logger.warn("OIDC callback but OIDC not initialized");
    return errorRedirect("provider_unreachable", returnContext);
  }
  const { server: as, client, clientAuth, baseUrl, insecure: allowHttp } =
    oidcState;

  const url = new URL(request.url);
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    const desc = url.searchParams.get("error_description") || errorParam;
    logger.warn(`OIDC provider returned error: ${desc}`);
    return errorRedirect("provider_denied", returnContext);
  }

  const storedState = parseCookieValue(cookieHeader, "oidc_state");
  const codeVerifier = parseCookieValue(cookieHeader, "oidc_code_verifier");
  if (!storedState || !codeVerifier) {
    logger.warn("OIDC callback: missing OIDC cookies");
    return errorRedirect("state_mismatch", returnContext);
  }

  const redirectUri = `${baseUrl}/auth/oidc/callback`;

  try {
    const params = oauth.validateAuthResponse(as, client, url, storedState);
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      clientAuth,
      params,
      redirectUri,
      codeVerifier,
      { [oauth.allowInsecureRequests]: allowHttp },
    );
    const result = await oauth.processAuthorizationCodeResponse(
      as,
      client,
      response,
    );
    const claims = oauth.getValidatedIdTokenClaims(result);
    if (!claims) {
      logger.warn("OIDC callback: no ID token claims in response");
      return errorRedirect("token_exchange_failed", returnContext);
    }
    const sub = claims.sub;
    const email = (claims.email as string) || null;
    const sessionId = returnContext === "wizard"
      ? await authService.activateWizardOidc(sub, email)
      : await authService.createSession("oidc", sub, email);
    return buildSuccessResponse(sessionId, returnContext, secure);
  } catch (err) {
    return classifyOidcError(err, logger, returnContext);
  }
}

export function createOidcRoutes(deps: OidcRouteDeps): Hono {
  const app = new Hono();
  app.get("/login", (c) =>
    buildLoginRedirect(
      deps.oidcService,
      deps.logger,
      c.req.raw,
      c.req.query("return") ?? null,
    ));
  app.get("/callback", (c) => processOidcCallback(deps, c.req.raw));
  return app;
}
