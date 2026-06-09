import type { QueryHandler } from "./types.ts";

export const authHandlers: Record<string, QueryHandler> = {
  "auth.session": (_i, s) => {
    const authMode = s.config.auth_mode || "none";
    return {
      authenticated: authMode === "none" ? true : s.authenticated,
      authMode,
    };
  },
  // OIDC is disabled in demo — no config to report.
  "auth.oidcConfig": () => null,
};
