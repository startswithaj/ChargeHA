import type {
  AdapterVehicleChargeState,
  CallContext,
  VehicleAdapter,
} from "@chargeha/shared";
import { sleep } from "@chargeha/shared/async";
import type { TeslaTokenManager } from "./TeslaTokenManager.ts";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "../../../PluginDbLogger.ts";

/** Execute fn, and if shouldRetry returns true, wait delayMs and try once more. */
async function retryOn(
  fn: () => Promise<Response>,
  shouldRetry: (r: Response) => boolean,
  delayMs: number,
): Promise<Response> {
  const first = await fn();
  if (!shouldRetry(first)) return first;
  await sleep(delayMs);
  return fn();
}

export class TeslaConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "TeslaConnectionError";
  }
}

export class TeslaApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "TeslaApiError";
    this.statusCode = statusCode;
  }
}

// Tesla hardware minimum charging amps
const MIN_CHARGE_AMPS = 5;

// Wake-up polling config
const WAKE_POLL_INTERVAL_MS = 15000;
const WAKE_TIMEOUT_MS = 60000;

/** Tesla Fleet API charge_state fields used by this adapter. */
interface TeslaChargeState {
  battery_level?: number;
  charge_limit_soc?: number;
  charging_state?: string;
  charge_amps?: number;
  charge_current_request_max?: number;
  charger_power?: number;
  charger_voltage?: number;
  charger_phases?: number;
  charge_energy_added?: number;
  minutes_to_full_charge?: number;
  charge_port_door_open?: boolean;
}

/** Tesla Fleet API vehicle_state fields used by this adapter. */
interface TeslaVehicleState {
  vehicle_name?: string;
  car_type?: string;
}

/** Tesla Fleet API drive_state fields used by this adapter. */
interface TeslaDriveState {
  latitude?: number;
  longitude?: number;
}

/** Response shape for /vehicle_data with charge_state + vehicle_state endpoints. */
interface TeslaVehicleDataResponse {
  charge_state: TeslaChargeState;
  vehicle_state?: TeslaVehicleState;
  drive_state?: TeslaDriveState;
  state?: string;
}

/** Response shape for /vehicles list endpoint. */
interface TeslaVehicleListItem {
  vin: string;
  state: string;
  display_name?: string;
}

/** Response shape for command endpoints. */
interface TeslaCommandResponse {
  result: boolean;
  reason?: string;
}

export class TeslaAdapter implements VehicleAdapter {
  private vin: string;
  private tokenManager: TeslaTokenManager;
  private proxyUrl: string;
  private logger: Logger;
  private dbLog: PluginDbLogger;

  constructor(
    vin: string,
    tokenManager: TeslaTokenManager,
    proxyUrl: string,
    logger: Logger,
    dbLog: PluginDbLogger,
  ) {
    this.vin = vin;
    this.tokenManager = tokenManager;
    this.proxyUrl = proxyUrl;
    this.logger = logger;
    this.dbLog = dbLog;
  }

  async connect(ctx: CallContext): Promise<void> {
    // Verify we can reach the Fleet API
    try {
      await this.isVehicleOnline(ctx);
      this.logger.info(`Connected to vehicle ${this.vin}`);
    } catch (error) {
      throw new TeslaConnectionError(
        `Failed to connect to Tesla Fleet API for VIN ${this.vin}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection to clean up
  }

  async getChargeState(ctx: CallContext): Promise<AdapterVehicleChargeState> {
    // `;` must be percent-encoded — Tesla's gateway treats raw `;` as a
    // query-param separator and silently drops everything after the
    // first endpoint, leaving drive_state / vehicle_state missing.
    const endpoints = encodeURIComponent(
      "charge_state;vehicle_state;location_data",
    );
    const data = await this.fleetApiGet<TeslaVehicleDataResponse>(
      `/api/1/vehicles/${this.vin}/vehicle_data?endpoints=${endpoints}`,
      ctx,
    );

    const response = data.response;
    const charge = response.charge_state;
    const vehicle = response.vehicle_state;
    const drive = response.drive_state;
    const chargingState = charge.charging_state ?? "Unknown";
    const chargeAmps = charge.charge_amps ?? 0;
    const chargerVoltage = charge.charger_voltage ?? 0;
    const chargerPhases = charge.charger_phases ?? 1;
    // Compute from V × I × phases — Tesla's charger_power field rounds to
    // integer kW, which misreports e.g. 1.44 kW as 1 and shows 0 during
    // ramp-up transitions.
    const chargerPowerKw =
      Math.round(chargeAmps * chargerVoltage * chargerPhases / 10) / 100;
    const notChargingStates = [
      "Disconnected",
      "Stopped",
      "Complete",
      "NoPower",
    ];
    const definitelyNotCharging = notChargingStates.includes(chargingState);
    const chargingStates = ["Charging", "Starting"];
    const isCharging = chargingStates.includes(chargingState) ||
      chargerPowerKw > 0.1 || (!definitelyNotCharging && chargeAmps > 0);

    return {
      vehicleId: this.vin,
      batteryLevel: charge.battery_level ?? 0,
      chargeLimit: charge.charge_limit_soc ?? 0,
      isCharging,
      isPluggedIn: chargingState !== "Disconnected",
      isOnline: response.state === "online",
      chargeAmps,
      chargeAmpsMax: charge.charge_current_request_max ?? 0,
      chargeAmpsMin: MIN_CHARGE_AMPS,
      chargePowerKw: chargerPowerKw,
      chargerVoltage,
      chargerPhases,
      energyAddedKwh: charge.charge_energy_added ?? 0,
      minutesToFull: charge.minutes_to_full_charge ?? 0,
      chargePortOpen: charge.charge_port_door_open ?? false,
      vehicleName: vehicle?.vehicle_name ?? "Tesla",
      lastUpdated: new Date().toISOString(),
      latitude: drive?.latitude ?? null,
      longitude: drive?.longitude ?? null,
    };
  }

  async startCharging(ctx: CallContext): Promise<boolean> {
    const { ok, reason } = await this.sendCommand(
      "charge_start",
      undefined,
      ctx,
    );
    // is_charging = vehicle is already charging; treat as no-op success.
    if (!ok && reason?.includes("is_charging")) {
      this.logger.info("charge_start no-op: vehicle already charging");
      return true;
    }
    return ok;
  }

  async stopCharging(ctx: CallContext): Promise<boolean> {
    const { ok, reason } = await this.sendCommand(
      "charge_stop",
      undefined,
      ctx,
    );
    // not_charging = vehicle is already stopped; treat as no-op success.
    if (!ok && reason?.includes("not_charging")) {
      this.logger.info("charge_stop no-op: vehicle already stopped");
      return true;
    }
    return ok;
  }

  async setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    const { ok } = await this.sendCommand(
      "set_charging_amps",
      { charging_amps: amps },
      ctx,
    );
    return ok;
  }

  async setChargeLimit(percent: number, ctx: CallContext): Promise<boolean> {
    const { ok } = await this.sendCommand(
      "set_charge_limit",
      { percent },
      ctx,
    );
    return ok;
  }

  async wakeVehicle(ctx: CallContext): Promise<boolean> {
    // Check if vehicle is already online before sending wake POST
    if (await this.isVehicleOnline(ctx)) {
      this.logger.debug(`Vehicle ${this.vin} is already online, skipping wake`);
      return true;
    }

    this.logger.debug(`Waking vehicle ${this.vin}`);
    const fleetBase = await this.tokenManager.getFleetApiBaseUrl();
    const token = await this.tokenManager.getAccessToken();

    const sendCtx: CallContext = { ...ctx, origin: `${ctx.origin}:send` };
    const response = await this.fetchWithAuth(
      `${fleetBase}/api/1/vehicles/${this.vin}/wake_up`,
      token,
      { method: "POST" },
      sendCtx,
    );
    // Consume response body to avoid leak
    await response.text();

    // Poll until online or timeout
    const pollCtx: CallContext = {
      ...ctx,
      origin: `${ctx.origin}:wake-poll`,
    };
    const maxAttempts = Math.ceil(WAKE_TIMEOUT_MS / WAKE_POLL_INTERVAL_MS);
    const online = await Array.from({ length: maxAttempts }).reduce(
      (chain: Promise<boolean>) =>
        chain.then(async (found) => {
          if (found) return true;
          // Sleep before each poll — Tesla needs ~15s to come fully online
          // after the wake_up POST; polling sooner just burns rate-limit quota.
          await sleep(WAKE_POLL_INTERVAL_MS);
          const data = await this.fleetApiGet<TeslaVehicleListItem[]>(
            "/api/1/vehicles",
            pollCtx,
          );
          const vehicles = data.response;
          const vehicle = vehicles?.find((v) => v.vin === this.vin);
          return vehicle?.state === "online";
        }),
      Promise.resolve(false),
    );

    if (online) {
      this.logger.debug(`Vehicle ${this.vin} is now online`);
      return true;
    }
    this.logger.debug(`Vehicle ${this.vin} wake timed out`);
    return false;
  }

  async isVehicleOnline(ctx: CallContext): Promise<boolean> {
    const checkCtx: CallContext = {
      ...ctx,
      origin: `${ctx.origin}:online-check`,
    };
    const data = await this.fleetApiGet<TeslaVehicleListItem[]>(
      "/api/1/vehicles",
      checkCtx,
    );
    const vehicles = data.response;
    const vehicle = vehicles?.find((v) => v.vin === this.vin);
    return vehicle?.state === "online";
  }

  // ---- Private helpers ----

  // Tesla Fleet API cost schedule (effective Jan 2025)
  // https://developer.tesla.com/docs/fleet-api/billing-and-limits
  private static readonly API_COSTS: Array<{ pattern: RegExp; cost: number }> =
    [
      { pattern: /\/wake_up$/, cost: 0.02 },
      { pattern: /\/vehicle_data/, cost: 0.002 },
      { pattern: /\/command\//, cost: 0.001 },
      { pattern: /\/api\/1\/vehicles$/, cost: 0 },
    ];

  /** Look up the per-call cost for an endpoint. */
  private static endpointCost(endpoint: string): number {
    return TeslaAdapter.API_COSTS.find((c) => c.pattern.test(endpoint))?.cost ??
      0;
  }

  /** Map HTTP status codes to user-friendly messages. */
  private friendlyStatus(status: number, context: string): string {
    switch (status) {
      case 401:
        return "Tesla authentication expired — reconnect in Settings";
      case 403:
        return "Tesla rejected the request — check your API permissions";
      case 404:
        return "Vehicle not found — it may have been removed from your Tesla account";
      case 408:
        return "Vehicle did not respond — it may be asleep or out of range";
      case 429:
        return "Too many requests — Tesla is rate limiting, try again shortly";
      case 500:
      case 502:
      case 503:
        return `Tesla service error — try again in a moment (${context})`;
      case 540:
        return "Vehicle is offline or in a deep sleep state";
      default:
        return `Tesla returned an unexpected error (${status})`;
    }
  }

  /** Try to extract a reason string from a Tesla API error response body. */
  private async parseErrorBody(response: Response): Promise<string | null> {
    try {
      const data = await response.json();
      return data.error?.message ?? data.error ?? null;
    } catch (e) {
      const text = await response.text().catch(() => "unreadable");
      this.logger.debug("Could not parse error body:", e, text);
      return null;
    }
  }

  private async fleetApiGet<T>(
    path: string,
    ctx: CallContext,
  ): Promise<{ response: T }> {
    const fleetBase = await this.tokenManager.getFleetApiBaseUrl();
    const token = await this.tokenManager.getAccessToken();

    const attempt = (): Promise<Response> =>
      this.fetchWithAuth(
        `${fleetBase}${path}`,
        token,
        { method: "GET" },
        ctx,
      );

    // Tesla's Fleet API returns 408 when the vehicle is slow to respond
    // (their server-side timeout, not ours). Retry once before giving up —
    // a single 408 during active charging is almost always transient.
    const response = await retryOn(
      attempt,
      (r) => {
        if (r.status !== 408) return false;
        this.logger.info(
          `Got 408 for ${path}, retrying once after 2s (origin: ${ctx.origin})`,
        );
        return true;
      },
      2000,
    );

    if (!response.ok) {
      const reason = await this.parseErrorBody(response);
      const message = reason ??
        this.friendlyStatus(response.status, "reading vehicle data");
      throw new TeslaApiError(message, response.status);
    }

    return await response.json();
  }

  private async sendCommand(
    command: string,
    body: Record<string, unknown> | undefined,
    ctx: CallContext,
  ): Promise<{ ok: boolean; reason: string | null }> {
    this.logger.debug(`Sending command ${command} to vehicle ${this.vin}`);
    const token = await this.tokenManager.getAccessToken();
    const url =
      `${this.proxyUrl}/api/1/vehicles/${this.vin}/command/${command}`;

    const response = await this.fetchWithAuth(url, token, {
      method: "POST",
      body,
    }, ctx);

    if (!response.ok) {
      const reason = await this.parseErrorBody(response);
      const message = reason ??
        this.friendlyStatus(response.status, "sending command");
      throw new TeslaApiError(message, response.status);
    }

    const data: { response: TeslaCommandResponse } = await response.json();
    const ok = data.response?.result === true;
    const reason = data.response?.reason ?? null;
    if (!ok) {
      this.dbLog.warn(`Command rejected: ${command}`, {
        payload: { command, reason, vin: this.vin },
        origin: ctx.origin,
        traceId: ctx.traceId,
      });
    }
    return { ok, reason };
  }

  private async fetchWithAuth(
    url: string,
    token: string,
    request: { method: "GET" | "POST"; body?: Record<string, unknown> },
    ctx: CallContext,
  ): Promise<Response> {
    const { method, body } = request;
    const parsedUrl = new URL(url);
    const endpoint = parsedUrl.pathname;
    const query = parsedUrl.search ? parsedUrl.search.slice(1) : undefined;
    const start = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body && { "Content-Type": "application/json" }),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(35000),
      });

      const durationMs = Date.now() - start;
      const responseBody = await response.clone().json()
        .catch((e: unknown) => {
          this.logger.debug("Response body is not JSON:", e);
          return undefined;
        });

      const cost = TeslaAdapter.endpointCost(endpoint);
      const payload = {
        method,
        endpoint,
        query,
        status: response.status,
        durationMs,
        cost,
        vin: this.vin,
        request: body,
        response: responseBody,
      };
      const logOpts = { payload, origin: ctx.origin, traceId: ctx.traceId };
      if (response.ok) {
        this.dbLog.info(`${method} ${endpoint}`, logOpts);
      } else {
        this.dbLog.warn(`${method} ${endpoint}`, logOpts);
      }

      return response;
    } catch (error) {
      const durationMs = Date.now() - start;
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);

      const cost = TeslaAdapter.endpointCost(endpoint);
      this.dbLog.error(`${method} ${endpoint}`, {
        payload: {
          method,
          endpoint,
          query,
          durationMs,
          cost,
          vin: this.vin,
          request: body,
          error: errorMessage,
        },
        origin: ctx.origin,
        traceId: ctx.traceId,
      });

      if (error instanceof TeslaApiError) throw error;
      // Provide a user-friendly message depending on which host we failed to reach
      const isProxy = url.startsWith(this.proxyUrl);
      const message = isProxy
        ? "Tesla command proxy is not running — start tesla-http-proxy on port 4443"
        : "Could not reach Tesla Fleet API — check your internet connection";
      throw new TeslaConnectionError(
        message,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
