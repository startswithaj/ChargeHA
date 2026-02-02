import * as oauth from "oauth4webapi";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { OidcConfigRow } from "../db/types.ts";
import { decrypt } from "../lib/Encryption.ts";
import type { Logger } from "../lib/Logger.ts";

/** Resolved OIDC state used by the login/callback handlers. */
export interface OidcState {
  server: oauth.AuthorizationServer;
  client: oauth.Client;
  clientAuth: oauth.ClientAuth;
  baseUrl: string;
  /** True when issuer is HTTP (local dev). Passed to oauth4webapi calls
   *  that otherwise reject non-HTTPS requests. */
  insecure: boolean;
}

export class OidcService {
  constructor(
    private db: AppDatabase,
    private encryptionKey: string | null,
    private logger: Logger,
  ) {}

  /**
   * Resolve the current OIDC state on demand.
   *
   * Returns null when auth_mode is not "oidc" (login routes treat as 404).
   * Otherwise loads OIDC config from the DB and runs discovery against the
   * issuer. Login/callback happen rarely, so the per-request discovery fetch
   * is negligible — no caching.
   */
  async getState(): Promise<OidcState | null> {
    const authMode = await this.db.getConfig("auth_mode");
    if (authMode !== "oidc") return null;

    const config = await this.db.getOidcConfig();
    if (!config) return null;

    const clientSecret = await this.decryptOidcSecret(config);

    try {
      const issuer = new URL(config.issuerUrl);
      // oauth4webapi enforces HTTPS by default. Allow HTTP for local dev
      // providers (e.g. Dex on localhost) by setting allowInsecureRequests.
      const allowHttp = issuer.protocol === "http:";
      const response = await oauth.discoveryRequest(issuer, {
        signal: AbortSignal.timeout(10000),
        [oauth.allowInsecureRequests]: allowHttp,
      });
      const server = await oauth.processDiscoveryResponse(issuer, response);

      return {
        server,
        client: { client_id: config.clientId },
        clientAuth: oauth.ClientSecretPost(clientSecret),
        baseUrl: config.baseUrl.replace(/\/+$/, ""),
        insecure: allowHttp,
      };
    } catch (err) {
      // Discovery failure means login is broken — log at error level.
      this.logger.error(
        `OIDC discovery failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ── OIDC discovery testing ──────────────────────────────────────────

  /**
   * Test OIDC discovery endpoint reachability (non-throwing).
   * Returns { success, error? } for wizard flow and changeMode validation.
   */
  async testDiscovery(
    issuerUrl: string,
  ): Promise<
    { success: true; error?: undefined } | { success: false; error: string }
  > {
    const discoveryUrl = `${
      issuerUrl.replace(/\/+$/, "")
    }/.well-known/openid-configuration`;
    try {
      const res = await fetch(discoveryUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return {
          success: false,
          error: `Discovery endpoint returned ${res.status}`,
        };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Discovery endpoint unreachable: ${(err as Error).message}`,
      };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /** Decrypt the OIDC client secret if encrypted. */
  private async decryptOidcSecret(config: OidcConfigRow): Promise<string> {
    if (config.isEncrypted && this.encryptionKey) {
      return await decrypt(config.clientSecret, this.encryptionKey);
    }
    return config.clientSecret;
  }
}
