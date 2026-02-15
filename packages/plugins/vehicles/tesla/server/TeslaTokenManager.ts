import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { Logger } from "@chargeha/server/lib/Logger";

export interface TeslaAuthStatus {
  authenticated: boolean;
  vehicleConfigured: boolean;
  vin: string | null;
  vehicleName: string | null;
  keyPaired: boolean | null; // null = unknown/not checked yet
  domain: string | null; // TESLA_DOMAIN for key pairing link
}

export interface TeslaTokenConfig {
  clientId: string;
  clientSecret: string;
  region: "na" | "eu" | "cn";
}

const FLEET_API_URLS: Record<string, string> = {
  na: "https://fleet-api.prd.na.vn.cloud.tesla.com",
  eu: "https://fleet-api.prd.eu.vn.cloud.tesla.com",
  cn: "https://fleet-api.prd.cn.vn.cloud.tesla.com",
};

const AUTH_BASE_URL = "https://auth.tesla.com";
const TOKEN_URL = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
const CALLBACK_PATH = "/api/vehicle/tesla/callback";
const SCOPES =
  "openid offline_access vehicle_device_data vehicle_charging_cmds vehicle_location";

// Refresh tokens 30 minutes before expiry
const REFRESH_BUFFER_MS = 30 * 60 * 1000;

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export type FetchFn = typeof fetch;

export class TeslaTokenManager {
  private readonly deps: PluginDependencies;
  private readonly logger: Logger;
  private readonly fetch: FetchFn;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    deps: PluginDependencies,
    logger: Logger,
    fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
  ) {
    this.deps = deps;
    this.logger = logger;
    this.fetch = fetchFn;
  }

  /** Read credentials fresh from DB on every call. No stale cache. */
  private async getConfig(): Promise<TeslaTokenConfig> {
    const clientId = await this.deps.getConfig("client_id");
    const clientSecret = await this.deps.getConfig("client_secret");
    const region = await this.deps.getConfig("region");

    return {
      clientId: clientId || "",
      clientSecret: clientSecret || "",
      region: (region as "na" | "eu" | "cn") || "na",
    };
  }

  /**
   * Build the OAuth redirect URI from the request origin so the callback
   * always points back to the ChargeHA server.
   */
  getRedirectUri(requestOrigin: string): string {
    return `${requestOrigin}${CALLBACK_PATH}`;
  }

  async getAuthorizationUrl(
    state: string,
    requestOrigin: string,
  ): Promise<string> {
    // Persist the origin so the OAuth callback can reconstruct the same redirect_uri
    await this.deps.setConfig("oauth_origin", requestOrigin);
    const config = await this.getConfig();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: this.getRedirectUri(requestOrigin),
      scope: SCOPES,
      state,
    });
    return `${AUTH_BASE_URL}/oauth2/v3/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, requestOrigin: string): Promise<void> {
    const config = await this.getConfig();
    const audience = await this.getFleetApiBaseUrl(config);
    const response = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: this.getRedirectUri(requestOrigin),
        audience,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000)
      .toISOString();
    await this.saveTokens(data.access_token, data.refresh_token, expiresAt);

    this.scheduleRefresh(data.expires_in * 1000);
  }

  async getAccessToken(): Promise<string> {
    const tokens = await this.getTokens();
    if (!tokens) throw new Error("No tokens available");

    const expiresAt = new Date(tokens.expiresAt).getTime();
    const now = Date.now();

    // Token is expired or about to expire within the buffer
    if (expiresAt - now < REFRESH_BUFFER_MS) {
      await this.refreshTokens();
      const refreshed = await this.getTokens();
      if (!refreshed) throw new Error("Token refresh failed");
      return refreshed.accessToken;
    }

    return tokens.accessToken;
  }

  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.getTokens();
    if (!tokens) return false;

    const expiresAt = new Date(tokens.expiresAt).getTime();
    if (expiresAt > Date.now()) return true;

    // Access token expired — try refreshing with the refresh token
    try {
      await this.refreshTokens();
      return true;
    } catch {
      this.logger.error(
        "Token refresh failed during auth check — treating as unauthenticated",
      );
      return false;
    }
  }

  async getStatus(): Promise<TeslaAuthStatus> {
    const authenticated = await this.isAuthenticated();
    const vehicles = await this.deps.getVehicleRows();
    const teslaVehicle = vehicles.find((v) => v.adapterType === "tesla");

    const cachedPairing = await this.deps.getConfig("key_paired");
    const keyPairedMap: Record<string, boolean | null> = {
      "true": true,
      "false": false,
    };
    const keyPaired = keyPairedMap[cachedPairing ?? ""] ?? null;

    return {
      authenticated,
      vehicleConfigured: !!teslaVehicle,
      vin: teslaVehicle?.id ?? null,
      vehicleName: teslaVehicle?.name ?? null,
      keyPaired,
      domain: null,
    };
  }

  async startAutoRefresh(): Promise<void> {
    const tokens = await this.getTokens();
    if (!tokens) return;

    const expiresAt = new Date(tokens.expiresAt).getTime();
    const msUntilExpiry = expiresAt - Date.now();

    if (msUntilExpiry > REFRESH_BUFFER_MS) {
      this.scheduleRefresh(msUntilExpiry);
    } else {
      // Token is expired or within refresh buffer — refresh now
      await this.refreshTokens();
    }
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async getFleetApiBaseUrl(config?: TeslaTokenConfig): Promise<string> {
    const c = config ?? await this.getConfig();
    return FLEET_API_URLS[c.region] ?? FLEET_API_URLS.na;
  }

  private async refreshTokens(): Promise<void> {
    const tokens = await this.getTokens();
    if (!tokens) throw new Error("No tokens to refresh");

    const config = await this.getConfig();
    const response = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        refresh_token: tokens.refreshToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000)
      .toISOString();
    await this.saveTokens(
      data.access_token,
      data.refresh_token ?? tokens.refreshToken,
      expiresAt,
    );

    this.scheduleRefresh(data.expires_in * 1000);
    this.logger.info("Tokens refreshed successfully");
  }

  private async getTokens(): Promise<TokenSet | null> {
    const accessToken = await this.deps.getConfig("access_token");
    const refreshToken = await this.deps.getConfig("refresh_token");
    const expiresAt = await this.deps.getConfig("token_expires_at");
    if (!accessToken || !refreshToken || !expiresAt) return null;
    return { accessToken, refreshToken, expiresAt };
  }

  private async saveTokens(
    accessToken: string,
    refreshToken: string,
    expiresAt: string,
  ): Promise<void> {
    await this.deps.setConfig("access_token", accessToken);
    await this.deps.setConfig("refresh_token", refreshToken);
    await this.deps.setConfig("token_expires_at", expiresAt);
  }

  async deleteTokens(): Promise<void> {
    await this.deps.setConfig("access_token", "");
    await this.deps.setConfig("refresh_token", "");
    await this.deps.setConfig("token_expires_at", "");
  }

  private scheduleRefresh(msUntilExpiry: number): void {
    this.stopAutoRefresh();
    const delay = Math.max(msUntilExpiry - REFRESH_BUFFER_MS, 60000);
    this.refreshTimer = setTimeout(() => {
      this.refreshTokens().catch((err) => {
        this.logger.error("Auto-refresh failed:", err);
      });
    }, delay);
  }
}
