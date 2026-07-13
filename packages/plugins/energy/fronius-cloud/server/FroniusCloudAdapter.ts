import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";

const BASE_URL = "https://api.solarweb.com/swqapi";
const DEFAULT_ACCESS_KEY_ID = "FKIAB4CDA71C0763413DA942DC756742318B";
const DEFAULT_ACCESS_KEY_VALUE = "67315e19-6805-479e-994d-7193ee5f6125";
// Refresh token if within this many seconds of expiry
const TOKEN_REFRESH_MARGIN_SECONDS = 60;

export class FroniusCloudConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "FroniusCloudConnectionError";
  }
}

export class FroniusCloudAuthError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "FroniusCloudAuthError";
  }
}

export class FroniusCloudParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FroniusCloudParseError";
  }
}

export class FroniusCloudAdapter implements EnergySourceAdapter {
  pollIntervalSeconds(): number {
    return 30;
  }

  private loginEmail: string;
  private loginPassword: string;
  private pvSystemId: string;
  private logger: Logger;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number = 0; // Unix timestamp in ms

  constructor(
    loginEmail: string,
    loginPassword: string,
    pvSystemId: string,
    logger: Logger,
  ) {
    this.loginEmail = loginEmail;
    this.loginPassword = loginPassword;
    this.pvSystemId = pvSystemId;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    await this.login();
    // Validate connection by fetching system info
    try {
      const response = await this.fetchApi(
        `/pvsystems/${this.pvSystemId}`,
      );
      if (!response.ok) {
        throw new FroniusCloudConnectionError(
          `Failed to fetch PV system info: HTTP ${response.status}`,
        );
      }
      this.logger.info(`Connected to PV system ${this.pvSystemId}`);
    } catch (error) {
      if (
        error instanceof FroniusCloudConnectionError ||
        error instanceof FroniusCloudAuthError
      ) {
        throw error;
      }
      throw new FroniusCloudConnectionError(
        "Failed to validate connection to Fronius Cloud",
        error instanceof Error ? error : undefined,
      );
    }
  }

  disconnect(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    return Promise.resolve();
  }

  /** Fetch realtime energy flow data from Solar.web flowdata endpoint. */
  async getRealtimeData(): Promise<EnergyData> {
    const response = await this.fetchApi(
      `/pvsystems/${this.pvSystemId}/flowdata`,
    );
    const body = await response.json();

    // Response shape: { status: { isOnline }, data: { channels: [...] } }
    const status = body.status ?? body;
    const data = body.data ?? body;

    if (status.isOnline === false) {
      return {
        solarProductionW: 0,
        gridPowerW: 0,
        homeConsumptionW: 0,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: new Date().toISOString(),
      };
    }

    const channels: Array<{
      channelName: string;
      channelType: string;
      value: number | null;
      unit: string;
    }> = data.channels ?? [];

    const channelMap = new Map<string, number | null>(
      channels.map((ch) => [ch.channelName, ch.value]),
    );

    return {
      solarProductionW: channelMap.get("PowerPV") ?? 0,
      gridPowerW: channelMap.get("PowerFeedIn") ?? 0,
      homeConsumptionW: Math.abs(channelMap.get("PowerLoad") ?? 0),
      batteryPowerW: channelMap.get("PowerBattCharge") ?? null,
      batterySoc: channelMap.get("SOC") ?? null,
      gridVoltageV: null,
      lastUpdated: new Date().toISOString(),
    };
  }

  /** Fetch device/system info from Solar.web. */
  async getDeviceInfo(): Promise<DeviceInfo> {
    const [systemRes, devicesRes] = await Promise.all([
      this.fetchApi(`/pvsystems/${this.pvSystemId}`),
      this.fetchApi(`/pvsystems/${this.pvSystemId}/devices`),
    ]);

    const systemData = await systemRes.json();
    const devicesData = await devicesRes.json();

    // Get inverter model from first device
    const devices: Array<{
      deviceType?: string;
      model?: string;
      name?: string;
    }> = devicesData.devices ?? devicesData ?? [];
    const inverter = devices.find((d) => d.deviceType === "inverter") ??
      devices[0];

    return {
      id: this.pvSystemId,
      name: systemData.name ?? "Fronius Cloud",
      manufacturer: "Fronius",
      model: inverter?.model ?? "Solar.web",
    };
  }

  /** Authenticate with Solar.web via email/password to obtain JWT tokens. */
  async login(): Promise<void> {
    try {
      const response = await fetch(`${BASE_URL}/iam/jwt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "AccessKeyId": DEFAULT_ACCESS_KEY_ID,
          "AccessKeyValue": DEFAULT_ACCESS_KEY_VALUE,
        },
        body: JSON.stringify({
          userId: this.loginEmail,
          password: this.loginPassword,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new FroniusCloudAuthError(
          `Login failed: HTTP ${response.status}`,
        );
      }

      const data = await response.json();
      const token = data.jwtToken ?? data.accessToken;
      if (!token) {
        throw new FroniusCloudAuthError(
          "Login returned 200 but no access token — check email/password",
        );
      }
      this.accessToken = token;
      this.refreshToken = data.refreshToken;
      // jwtTokenExpiration is an ISO timestamp; expiresIn is seconds
      if (data.jwtTokenExpiration) {
        this.tokenExpiresAt = new Date(data.jwtTokenExpiration).getTime();
      } else {
        const expiresIn = data.expiresIn ?? 3600;
        this.tokenExpiresAt = Date.now() + expiresIn * 1000;
      }
    } catch (error) {
      if (error instanceof FroniusCloudAuthError) throw error;
      throw new FroniusCloudAuthError(
        "Failed to login to Fronius Cloud",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /** Refresh the access token using the refresh token. */
  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new FroniusCloudAuthError("No refresh token available");
    }

    try {
      const response = await fetch(
        `${BASE_URL}/iam/jwt/${this.refreshToken}`,
        {
          method: "PATCH",
          headers: {
            "AccessKeyId": DEFAULT_ACCESS_KEY_ID,
            "AccessKeyValue": DEFAULT_ACCESS_KEY_VALUE,
          },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        throw new FroniusCloudAuthError(
          `Token refresh failed: HTTP ${response.status}`,
        );
      }

      const data = await response.json();
      this.accessToken = data.jwtToken ?? data.accessToken;
      this.refreshToken = data.refreshToken;
      if (data.jwtTokenExpiration) {
        this.tokenExpiresAt = new Date(data.jwtTokenExpiration).getTime();
      } else {
        const expiresIn = data.expiresIn ?? 3600;
        this.tokenExpiresAt = Date.now() + expiresIn * 1000;
      }
    } catch (error) {
      if (error instanceof FroniusCloudAuthError) throw error;
      throw new FroniusCloudAuthError(
        "Failed to refresh Fronius Cloud token",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /** Ensure a valid access token is available — refresh or re-login as needed. */
  async ensureToken(): Promise<void> {
    if (!this.accessToken) {
      await this.login();
      return;
    }

    const timeUntilExpiry = this.tokenExpiresAt - Date.now();
    if (timeUntilExpiry > TOKEN_REFRESH_MARGIN_SECONDS * 1000) {
      // Token is still valid
      return;
    }

    // Token is near expiry — try refresh first, fall back to re-login
    try {
      await this.refreshAccessToken();
    } catch {
      this.logger.warn("Token refresh failed, re-authenticating...");
      await this.login();
    }
  }

  /** Make an authenticated API request to the Solar.web API. */
  async fetchApi(path: string): Promise<Response> {
    await this.ensureToken();

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        headers: {
          "Authorization": `Bearer ${this.accessToken}`,
          "AccessKeyId": DEFAULT_ACCESS_KEY_ID,
          "AccessKeyValue": DEFAULT_ACCESS_KEY_VALUE,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new FroniusCloudConnectionError(
          `Fronius Cloud returned HTTP ${response.status} for ${path}`,
        );
      }
      return response;
    } catch (error) {
      if (
        error instanceof FroniusCloudConnectionError ||
        error instanceof FroniusCloudAuthError
      ) {
        throw error;
      }
      throw new FroniusCloudConnectionError(
        `Failed to fetch ${path} from Fronius Cloud`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
