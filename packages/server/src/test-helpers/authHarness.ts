import { Hono } from "hono";
import {
  type AuthMiddlewareDeps,
  createAuthMiddleware,
} from "../middleware/auth.ts";
import type { SessionRow } from "../db/types.ts";
import type { AuthService } from "../services/AuthService.ts";
import type { ConfigService } from "../services/ConfigService.ts";
import type { InternalConfig } from "@chargeha/shared/configSections";
import type { Logger } from "../lib/Logger.ts";
import { throwingMock } from "./throwingMock.ts";

export function makeLogger(): Logger {
  return throwingMock<Logger>("Logger", {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  });
}

export function makeSession(overrides?: Partial<SessionRow>): SessionRow {
  const nowSecs = Math.floor(Date.now() / 1000);
  return {
    id: "sess-123",
    authType: "local",
    identifier: "admin",
    email: null,
    createdAt: nowSecs,
    expiresAt: nowSecs + 86400,
    ...overrides,
  };
}

export interface SetupAuthAppOpts {
  authMode?: string;
  validateSession?: (id: string) => Promise<SessionRow | null>;
  extraRoutes?: (app: Hono) => void;
}

export function setupAuthApp(
  opts: SetupAuthAppOpts = {},
): { app: Hono; deps: AuthMiddlewareDeps } {
  const authMode = opts.authMode ?? "local";
  const validateSession = opts.validateSession ??
    (() => Promise.resolve(null));

  const deps: AuthMiddlewareDeps = {
    authService: throwingMock<AuthService>("AuthService", { validateSession }),
    configService: throwingMock<ConfigService>("ConfigService", {
      getInternal: () =>
        Promise.resolve({ authMode } as unknown as InternalConfig),
    }),
    logger: makeLogger(),
  };

  const app = new Hono();
  app.use("*", createAuthMiddleware(deps));
  app.get("/protected", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ healthy: true }));
  app.get("/auth/oidc/login", (c) => c.text("oidc login"));
  app.get("/auth/oidc/callback", (c) => c.text("oidc callback"));
  app.get("/.well-known/openid-configuration", (c) => c.text("openid config"));
  app.all("/trpc/auth.login", (c) => c.json({ result: true }));
  app.all("/trpc/auth.session", (c) => c.json({ result: true }));
  app.all("/trpc/config.get", (c) => c.json({ result: true }));
  app.get("/", (c) => c.html("<html>shell</html>"));
  app.get("/login", (c) => c.html("<html>login</html>"));
  app.get("/assets/app.js", (c) => c.text("js"));
  app.get("/assets/style.css", (c) => c.text("css"));
  app.get("/logo.svg", (c) => c.text("svg"));
  opts.extraRoutes?.(app);
  return { app, deps };
}
