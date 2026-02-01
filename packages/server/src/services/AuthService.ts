/// <reference lib="deno.ns" />
import { hash, verify } from "@ts-rex/argon2";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { SessionRow } from "../db/types.ts";
import { maybeEncrypt } from "../lib/Encryption.ts";
import type { Logger } from "../lib/Logger.ts";
import type { RateLimiter } from "../middleware/rateLimit.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { OidcService } from "./OidcService.ts";

/** 30 days in seconds. */
const SESSION_TTL_SECS = 30 * 24 * 60 * 60;

/** 30 days in seconds (cookie Max-Age). */
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Minimum password length for local auth. */
const MIN_PASSWORD_LENGTH = 1;

/** Auth mode type. */
export type AuthMode = "none" | "local" | "oidc";

/** Session status returned by getSessionStatus(). */
export interface SessionStatus {
  authenticated: boolean;
  authMode: AuthMode;
  username?: string;
  resetAuthActive?: boolean;
}

/** Build a Set-Cookie header string for the session cookie. */
export function buildSessionCookie(
  sessionId: string,
  secure: boolean,
): string {
  const parts = [
    `session_id=${sessionId}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Build a Set-Cookie header string that clears the session cookie. */
export function buildClearCookie(secure: boolean): string {
  const parts = [
    "session_id=",
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Shared optional fields for all changeMode variants. */
interface ChangeModeBase {
  /** Required when current mode is local (re-auth). */
  currentPassword?: string;
}

/** Input for changeMode() — discriminated on newMode. */
export type ChangeModeInput =
  | (ChangeModeBase & { newMode: "none" })
  | (ChangeModeBase & {
    newMode: "local";
    localConfig: { username: string; password: string };
  })
  | (ChangeModeBase & {
    newMode: "oidc";
    oidcConfig: {
      issuerUrl: string;
      clientId: string;
      clientSecret: string;
      baseUrl: string;
    };
  });

export class AuthService {
  constructor(
    private db: AppDatabase,
    private encryptionKey: string | null,
    private logger: Logger,
    private oidcService: OidcService,
    private configService: ConfigService,
    private rateLimiter: RateLimiter,
  ) {}

  // ── Password hashing ───────────────────────────────────────────────────

  /** Hash a password using Argon2id with library defaults. */
  async hashPassword(password: string): Promise<string> {
    return await hash(password);
  }

  /** Verify a password against an Argon2id hash. */
  async verifyPassword(
    password: string,
    passwordHash: string,
  ): Promise<boolean> {
    return await verify(password, passwordHash);
  }

  // ── Session management ─────────────────────────────────────────────────

  /**
   * Create a new session row with a 30-day TTL.
   * Returns the session ID (UUID).
   */
  async createSession(
    authType: string,
    identifier: string,
    email?: string | null,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const nowSecs = Math.floor(Date.now() / 1000);
    await this.db.createSession({
      id,
      authType,
      identifier,
      email: email ?? null,
      createdAt: nowSecs,
      expiresAt: nowSecs + SESSION_TTL_SECS,
    });
    this.logger.info(`Session created for ${authType}:${identifier}`);
    return id;
  }

  /**
   * Validate a session by ID.
   * Returns the session row if valid and not expired, null otherwise.
   */
  async validateSession(
    sessionId: string,
  ): Promise<SessionRow | null> {
    const session = await this.db.getSession(sessionId);
    if (!session) return null;
    const nowSecs = Math.floor(Date.now() / 1000);
    if (session.expiresAt <= nowSecs) {
      return null;
    }
    return session;
  }

  /** Delete a session by ID. */
  async deleteSession(sessionId: string): Promise<void> {
    await this.db.deleteSession(sessionId);
  }

  // ── Local auth ─────────────────────────────────────────────────────────

  /**
   * Authenticate with username and password.
   * On success: creates a session, runs lazy expired-session cleanup, returns session ID.
   * On failure: throws with a generic message (no user enumeration).
   */
  async login(username: string, password: string): Promise<string> {
    const user = await this.db.getLocalUser(username);
    if (!user) {
      this.logger.warn("Login failed: invalid credentials");
      throw new Error("Invalid credentials");
    }

    const valid = await this.verifyPassword(password, user.passwordHash);
    if (!valid) {
      this.logger.warn("Login failed: invalid credentials");
      throw new Error("Invalid credentials");
    }

    // Lazy cleanup of expired sessions
    await this.db.deleteExpiredSessions();

    const sessionId = await this.createSession("local", user.username);
    this.logger.info(`User '${user.username}' logged in`);
    return sessionId;
  }

  /** Delete the session (logout). */
  async logout(sessionId: string): Promise<void> {
    await this.db.deleteSession(sessionId);
    this.logger.info("Session deleted (logout)");
  }

  // ── Password change ──────────────────────────────────────────────────

  /**
   * Change the current user's password.
   * Verifies current password, validates new password (min 8 chars),
   * updates the hash, and invalidates all sessions except the current one.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
    currentSessionId: string,
  ): Promise<void> {
    // Validate new password length
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        "BAD_REQUEST",
      );
    }

    const resetAuth = Deno.env.get("RESET_AUTH") === "true";

    if (resetAuth) {
      // RESET_AUTH bypasses current password verification — the user
      // can't log in normally and needs to set a new password.
      const user = await this.db.getFirstLocalUser();
      const username = user?.username;
      if (!username) {
        throw new AuthError("No local user exists", "BAD_REQUEST");
      }
      const newHash = await this.hashPassword(newPassword);
      await this.db.updateLocalUserPassword(username, newHash);
      this.logger.info(
        `Password reset via RESET_AUTH for user '${username}'`,
      );
      return;
    }

    // Look up current session to get the username
    const session = await this.db.getSession(currentSessionId);
    if (!session) {
      throw new AuthError("Invalid session", "UNAUTHORIZED");
    }

    // Verify current password
    const user = await this.db.getLocalUser(session.identifier);
    if (!user) {
      throw new AuthError("Invalid credentials", "UNAUTHORIZED");
    }

    const valid = await this.verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw new AuthError("Invalid credentials", "UNAUTHORIZED");
    }

    // Hash new password and update
    const newHash = await this.hashPassword(newPassword);
    await this.db.updateLocalUserPassword(user.username, newHash);

    // Invalidate all sessions except the current one
    await this.db.deleteSessionsExcept(currentSessionId);

    this.logger.info(`Password changed for user '${user.username}'`);
  }

  // ── Mode change ───────────────────────────────────────────────────────

  /**
   * Switch auth modes with re-auth and cleanup.
   * 5-step flow: check re-auth → validate new config → delete sessions →
   * clear old auth data → write new auth data → set auth_mode.
   */
  async changeMode(
    input: ChangeModeInput,
  ): Promise<string | null> {
    const currentConfig = await this.configService.getInternal();
    const currentMode = currentConfig.authMode as AuthMode;

    // Step 1: Re-auth check
    await this.validateReAuth(currentMode, input.currentPassword);

    // Step 2: Validate new mode config
    if (input.newMode === "local") {
      this.validateLocalConfig(input.localConfig);
    } else if (input.newMode === "oidc") {
      await this.validateOidcConfig(input.oidcConfig);
    }

    // Steps 3-4: Delete sessions and clear old auth data
    await this.clearAuthData(currentMode);

    // Step 5: Write new auth data and set auth_mode
    const sessionId = await this.writeNewAuthData(input);

    await this.configService.setInternal({ authMode: input.newMode });

    this.logger.info(
      `Auth mode changed from '${currentMode}' to '${input.newMode}'`,
    );

    return sessionId;
  }

  /**
   * Re-authenticate current user when switching away from local auth.
   * OIDC re-auth is handled by middleware (valid session required).
   */
  private async validateReAuth(
    currentMode: AuthMode,
    currentPassword?: string,
  ): Promise<void> {
    if (currentMode !== "local") return;

    if (!currentPassword) {
      throw new AuthError(
        "Current password required for re-authentication",
        "UNAUTHORIZED",
      );
    }
    // Verify current password against stored hash (single-tenant: one user)
    const localUser = await this.db.getFirstLocalUser();
    if (!localUser) {
      throw new AuthError("Invalid credentials", "UNAUTHORIZED");
    }
    const valid = await this.verifyPassword(
      currentPassword,
      localUser.passwordHash,
    );
    if (!valid) {
      throw new AuthError("Invalid credentials", "UNAUTHORIZED");
    }
  }

  /** Validate local auth config (username + password requirements). */
  private validateLocalConfig(
    localConfig: { username: string; password: string },
  ): void {
    if (!localConfig.username || localConfig.username.length < 1) {
      throw new AuthError("Username is required", "BAD_REQUEST");
    }
    if (localConfig.password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        "BAD_REQUEST",
      );
    }
  }

  /** Validate OIDC config and test discovery endpoint reachability. */
  private async validateOidcConfig(
    oidcConfig: {
      issuerUrl: string;
      clientId: string;
      clientSecret: string;
      baseUrl: string;
    },
  ): Promise<void> {
    // Test OIDC discovery endpoint reachability via OidcService
    const result = await this.oidcService.testDiscovery(oidcConfig.issuerUrl);
    if (!result.success) {
      throw new AuthError(result.error, "BAD_REQUEST");
    }
  }

  /** Delete all sessions and clear auth data for the current mode. */
  private async clearAuthData(currentMode: AuthMode): Promise<void> {
    await this.db.deleteAllSessions();

    if (currentMode === "local") {
      await this.db.deleteAllLocalUsers();
    } else if (currentMode === "oidc") {
      await this.db.deleteAllOidcConfigs();
    }
  }

  /** Write new auth data and auto-login for local mode. */
  private async writeNewAuthData(
    input: ChangeModeInput,
  ): Promise<string | null> {
    if (input.newMode === "local") {
      const passwordHash = await this.hashPassword(
        input.localConfig.password,
      );
      await this.db.createLocalUser({
        username: input.localConfig.username,
        passwordHash,
      });
      // Auto-create a session so the caller isn't immediately locked out
      return await this.createSession(
        "local",
        input.localConfig.username,
      );
    }

    if (input.newMode === "oidc") {
      const oidc = input.oidcConfig;
      const { value: clientSecret, isEncrypted } = await maybeEncrypt(
        oidc.clientSecret,
        this.encryptionKey,
      );
      await this.db.upsertOidcConfig({
        issuerUrl: oidc.issuerUrl,
        clientId: oidc.clientId,
        clientSecret,
        isEncrypted,
        baseUrl: oidc.baseUrl,
      });
    }

    return null;
  }

  // ── Wizard OIDC activation ──────────────────────────────────────────────

  /**
   * Activate OIDC auth mode during wizard flow.
   * Called by OIDC callback after successful provider login.
   * Cleans up existing sessions/users, sets auth_mode to "oidc",
   * and creates a new session.
   */
  async activateWizardOidc(
    sub: string,
    email: string | null,
  ): Promise<string> {
    // Clean up any existing auth data
    await this.db.deleteAllSessions();
    await this.db.deleteAllLocalUsers();

    // Set auth_mode to "oidc"
    await this.configService.setInternal({ authMode: "oidc" });

    // Create session for the OIDC user
    const sessionId = await this.createSession("oidc", sub, email);

    this.logger.info(`Wizard: OIDC auth activated for sub=${sub}`);
    return sessionId;
  }

  // ── Router handler methods ──────────────────────────────────────────────
  // These encapsulate all logic that previously lived in the auth router:
  // rate limiting, cookie handling, session guards, etc.

  /**
   * Handle login: rate limit check, credential verification,
   * rate limit recording, and session cookie setting.
   */
  async handleLogin(
    username: string,
    password: string,
    clientIp: string,
    responseHeaders?: Headers,
    isHttps?: boolean,
  ): Promise<{ success: true }> {
    const rateCheck = this.rateLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      throw new AuthError(
        JSON.stringify({ retryAfter: rateCheck.retryAfter }),
        "TOO_MANY_REQUESTS",
      );
    }

    try {
      const sessionId = await this.login(username, password);
      this.rateLimiter.recordSuccess(clientIp);

      if (responseHeaders) {
        responseHeaders.append(
          "Set-Cookie",
          buildSessionCookie(sessionId, isHttps ?? false),
        );
      }

      return { success: true as const };
    } catch (err) {
      this.rateLimiter.recordFailure(clientIp);
      throw err;
    }
  }

  /**
   * Handle logout: session deletion and cookie clearing.
   */
  async handleLogout(
    sessionId: string | null | undefined,
    responseHeaders?: Headers,
    isHttps?: boolean,
  ): Promise<{ success: true }> {
    if (sessionId) {
      await this.logout(sessionId);
    }

    if (responseHeaders) {
      responseHeaders.append(
        "Set-Cookie",
        buildClearCookie(isHttps ?? false),
      );
    }

    return { success: true as const };
  }

  /**
   * Get session status: RESET_AUTH check, auth mode check, session validation.
   */
  async getSessionStatus(
    sessionId?: string | null,
  ): Promise<SessionStatus> {
    const internal = await this.configService.getInternal();
    const authMode = internal.authMode as AuthMode;

    // RESET_AUTH bypasses auth — report as authenticated with warning
    const resetAuth = Deno.env.get("RESET_AUTH") === "true";
    if (resetAuth) {
      return { authenticated: true, authMode, resetAuthActive: true };
    }

    // No auth mode — everyone is authenticated
    if (authMode === "none") {
      return { authenticated: true, authMode };
    }

    // Check session validity
    if (sessionId) {
      const session = await this.validateSession(sessionId);
      if (session) {
        return { authenticated: true, authMode, username: session.identifier };
      }
    }

    return { authenticated: false, authMode };
  }

  // ── OIDC config update ──────────────────────────────────────────────

  /**
   * Update OIDC config in-place (for changing providers while already on OIDC).
   * Tests discovery, saves config, refreshes OidcService cache.
   * Does NOT touch sessions or authMode.
   */
  async updateOidcConfig(input: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    baseUrl: string;
  }): Promise<{ success: true }> {
    // Test OIDC discovery endpoint reachability
    const result = await this.oidcService.testDiscovery(input.issuerUrl);
    if (!result.success) {
      throw new AuthError(result.error, "BAD_REQUEST");
    }

    // Encrypt secret if encryption key is available
    const { value: clientSecret, isEncrypted } = await maybeEncrypt(
      input.clientSecret,
      this.encryptionKey,
    );

    // Save config
    await this.db.upsertOidcConfig({
      issuerUrl: input.issuerUrl,
      clientId: input.clientId,
      clientSecret,
      isEncrypted,
      baseUrl: input.baseUrl,
    });

    // OidcService.getState() reads the new config on next /auth/oidc/login.
    this.logger.info(
      `OIDC config updated: issuer=${input.issuerUrl}`,
    );

    return { success: true as const };
  }

  /**
   * Handle updateOidcConfig: delegates to updateOidcConfig().
   */
  async handleUpdateOidcConfig(input: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    baseUrl: string;
  }): Promise<{ success: true }> {
    return await this.updateOidcConfig(input);
  }

  /**
   * Get the current OIDC config (non-sensitive fields only).
   * Returns null if no OIDC config is stored.
   */
  async getOidcConfig(): Promise<
    {
      issuerUrl: string;
      clientId: string;
      baseUrl: string;
    } | null
  > {
    const config = await this.db.getOidcConfig();
    if (!config) return null;
    return {
      issuerUrl: config.issuerUrl,
      clientId: config.clientId,
      baseUrl: config.baseUrl,
    };
  }

  /**
   * Handle change password: session guard + delegation to changePassword.
   */
  async handleChangePassword(
    currentPassword: string,
    newPassword: string,
    sessionId?: string | null,
  ): Promise<{ success: true }> {
    const resetAuth = Deno.env.get("RESET_AUTH") === "true";
    if (!sessionId && !resetAuth) {
      throw new AuthError("No active session", "UNAUTHORIZED");
    }

    await this.changePassword(
      currentPassword,
      newPassword,
      sessionId ?? "",
    );
    return { success: true as const };
  }

  /**
   * Handle change mode: delegates to changeMode and sets session cookie
   * if a session was created (local mode auto-login).
   */
  async handleChangeMode(
    input: ChangeModeInput,
    responseHeaders?: Headers,
    isHttps?: boolean,
  ): Promise<{ success: true }> {
    const sessionId = await this.changeMode(input);

    if (sessionId && responseHeaders) {
      responseHeaders.append(
        "Set-Cookie",
        buildSessionCookie(sessionId, isHttps ?? false),
      );
    }

    return { success: true as const };
  }
}

/** Error with a code for tRPC mapping. */
export class AuthError extends Error {
  constructor(
    message: string,
    public code: "UNAUTHORIZED" | "BAD_REQUEST" | "TOO_MANY_REQUESTS",
  ) {
    super(message);
    this.name = "AuthError";
  }
}
