import type { AppDatabase } from "../../db/AppDatabase.ts";
import type { Logger } from "../../lib/Logger.ts";
import type { ConfigService } from "../ConfigService.ts";
import type { OidcService } from "../OidcService.ts";

export const createMockLogger = (): Logger =>
  ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }) as unknown as Logger;

export const createMockDb = (
  // deno-lint-ignore no-explicit-any
  overrides: Record<string, any> = {},
): AppDatabase =>
  ({
    createSession: () => Promise.resolve({ id: "session-1" }),
    getSession: () => Promise.resolve(null),
    deleteSession: () => Promise.resolve(),
    deleteSessionsExcept: () => Promise.resolve(),
    deleteAllSessions: () => Promise.resolve(),
    deleteExpiredSessions: () => Promise.resolve(),
    getLocalUser: () => Promise.resolve(null),
    getFirstLocalUser: () => Promise.resolve(null),
    createLocalUser: () => Promise.resolve({}),
    updateLocalUserPassword: () => Promise.resolve(),
    deleteAllLocalUsers: () => Promise.resolve(),
    upsertOidcConfig: () => Promise.resolve({}),
    deleteAllOidcConfigs: () => Promise.resolve(),
    ...overrides,
  }) as unknown as AppDatabase;

export const createMockConfigService = (
  authMode: "none" | "local" | "oidc" = "none",
  // deno-lint-ignore no-explicit-any
  overrides: Record<string, any> = {},
): ConfigService => {
  class MutableConfig {
    mode: "none" | "local" | "oidc" = authMode;
    getInternal = (): Promise<{ authMode: "none" | "local" | "oidc" }> =>
      Promise.resolve({ authMode: this.mode });
    setInternal = (
      input: { authMode?: "none" | "local" | "oidc" },
    ): Promise<boolean> => {
      if (input.authMode) this.mode = input.authMode;
      return Promise.resolve(false);
    };
  }
  return Object.assign(
    new MutableConfig(),
    overrides,
  ) as unknown as ConfigService;
};

export const createMockOidcService = (
  // deno-lint-ignore no-explicit-any
  overrides: Record<string, any> = {},
): OidcService =>
  ({
    testDiscovery: () => Promise.resolve({ success: true }),
    initOidc: () => Promise.resolve(),
    getOidcServer: () => null,
    getOidcClient: () => null,
    getOidcClientAuth: () => null,
    getOidcBaseUrl: () => null,
    ...overrides,
  }) as unknown as OidcService;
