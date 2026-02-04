import { Hono } from "hono";
import type * as oauth from "oauth4webapi";
import { createOidcRoutes } from "../oidcAuth.ts";
import type { OidcRouteDeps } from "../oidcAuth.ts";
import type { AuthService } from "../../services/AuthService.ts";
import type { OidcService, OidcState } from "../../services/OidcService.ts";
import type { Logger } from "../../lib/Logger.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

export function makeAuthorizationServer(
  overrides?: Partial<oauth.AuthorizationServer>,
): oauth.AuthorizationServer {
  return {
    issuer: "https://idp.example.com",
    authorization_endpoint: "https://idp.example.com/authorize",
    token_endpoint: "https://idp.example.com/token",
    ...overrides,
  } as oauth.AuthorizationServer;
}

export interface OidcStateOverrides {
  oidcServer?: oauth.AuthorizationServer | null;
  oidcClient?: oauth.Client | null;
  oidcClientAuth?: oauth.ClientAuth | null;
  oidcBaseUrl?: string | null;
}

export interface AuthServiceOverrides {
  createSession?: (
    authType: string,
    identifier: string,
    email?: string | null,
  ) => Promise<string>;
  activateWizardOidc?: (
    sub: string,
    email: string | null,
  ) => Promise<string>;
}

export type SetupOverrides = OidcStateOverrides & AuthServiceOverrides & {
  /** When true, the OIDC service reports "not initialized" (default false). */
  uninitialized?: boolean;
  /** Provide a fully custom client_id without other server overrides. */
  clientId?: string;
};

const DEFAULT_BASE_URL = "https://app.example.com";

function makeOidcService(overrides: SetupOverrides): OidcService {
  return throwingMock<OidcService>("OidcService", {
    getState: (): Promise<OidcState | null> => {
      if (overrides.uninitialized) return Promise.resolve(null);
      return Promise.resolve({
        server: overrides.oidcServer ?? makeAuthorizationServer(),
        client: overrides.oidcClient ??
          { client_id: overrides.clientId ?? "test-client" },
        clientAuth: overrides.oidcClientAuth ??
          throwingMock<oauth.ClientAuth>("ClientAuth"),
        baseUrl: overrides.oidcBaseUrl ?? DEFAULT_BASE_URL,
        insecure: false,
      });
    },
  });
}

function makeAuthService(overrides: SetupOverrides): AuthService {
  return throwingMock<AuthService>("AuthService", {
    createSession: overrides.createSession ??
      (() => Promise.resolve("new-session-id")),
    activateWizardOidc: overrides.activateWizardOidc ??
      (() => Promise.resolve("wizard-session-id")),
  });
}

export function makeDeps(overrides: SetupOverrides = {}): OidcRouteDeps {
  return {
    authService: makeAuthService(overrides),
    oidcService: makeOidcService(overrides),
    logger: throwingMock<Logger>("Logger", {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  };
}

/**
 * Build a test Hono app with OIDC routes mounted at `/auth/oidc`.
 * Pass `{ uninitialized: true }` to simulate OIDC not configured.
 */
export function setupOidcApp(
  overrides: SetupOverrides = {},
): { app: Hono; deps: OidcRouteDeps } {
  const deps = makeDeps(overrides);
  const app = new Hono();
  app.route("/auth/oidc", createOidcRoutes(deps));
  return { app, deps };
}

/** Parse all Set-Cookie from raw headers. */
export function getAllSetCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}
