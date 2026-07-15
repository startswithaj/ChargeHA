/// <reference lib="deno.ns" />
import { TRPCError } from "@trpc/server";
import { inSequence, sleep } from "@chargeha/shared/async";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { TeslaTokenManager } from "./TeslaTokenManager.ts";
import {
  type PublicKeyHosting,
  resolvePublicKeyDomain,
} from "../shared/publicKeyDomain.ts";
import type { Logger } from "@chargeha/server/lib/Logger";

const TOKEN_URL = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";

export interface TeslaServiceIo {
  fetch: typeof globalThis.fetch;
  connect: typeof Deno.connect;
  /** Delay between wake poll attempts (default 3000ms) */
  wakePollDelayMs?: number;
  /** Max wake poll attempts (default 10) */
  wakePollAttempts?: number;
}

export class TeslaService {
  private readonly deps: PluginDependencies;
  private readonly tokenManager: TeslaTokenManager;
  private readonly logger: Logger;
  private readonly io: TeslaServiceIo;

  constructor(
    deps: PluginDependencies,
    tokenManager: TeslaTokenManager,
    logger: Logger,
    io: TeslaServiceIo = { fetch: globalThis.fetch, connect: Deno.connect },
  ) {
    this.deps = deps;
    this.tokenManager = tokenManager;
    this.logger = logger;
    this.io = io;
  }

  /** List vehicles from Tesla Fleet API. */
  async listFleetVehicles(): Promise<
    { vehicles: { vin: string; name: string; state: string }[] }
  > {
    try {
      const token = await this.tokenManager.getAccessToken();
      const fleetBase = await this.tokenManager.getFleetApiBaseUrl();

      const response = await this.io.fetch(`${fleetBase}/api/1/vehicles`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Tesla API error: ${text}`,
        });
      }

      const data = await response.json();
      const vehicles = data.response.map((
        v: { vin: string; display_name: string; state: string },
      ) => ({
        vin: v.vin,
        name: v.display_name,
        state: v.state,
      }));

      return { vehicles };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Failed to list vehicles",
      });
    }
  }

  /** Disconnect Tesla: stop refresh, remove vehicles, clear tokens. */
  async disconnect(): Promise<{ success: true }> {
    try {
      // Stop auto-refresh
      this.tokenManager.stopAutoRefresh();

      // Remove all Tesla vehicles from the manager
      const vehicles = await this.deps.getVehicleRows();
      await inSequence(vehicles, (v) => this.deps.deleteVehicle(v.id));

      // Clear stored tokens
      await this.tokenManager.deleteTokens();

      this.logger.info(
        "Tesla disconnected — tokens cleared, vehicles removed",
      );
      return { success: true as const };
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Disconnect failed",
      });
    }
  }

  /** Select and register a vehicle from Tesla Fleet API. */
  async selectVehicle(
    input: { vin: string; name?: string },
  ): Promise<{ success: true; vin: string }> {
    await this.selectVehicles({
      vehicles: [{ vin: input.vin, name: input.name, priority: 1 }],
    });
    return { success: true as const, vin: input.vin };
  }

  /** Select and register multiple vehicles with their charging priorities in
   *  one call — the wizard saves its whole selection server-side instead of
   *  chaining per-vehicle mutations from the browser. */
  async selectVehicles(
    input: { vehicles: { vin: string; name?: string; priority: number }[] },
  ): Promise<{ success: true; vins: string[] }> {
    await inSequence(input.vehicles, (vehicle) => this.saveVehicle(vehicle));

    // Trigger pairing check in the background after adding vehicles
    this.checkKeyPairing().catch((err) => {
      this.logger.error("Background key pairing check failed:", err);
    });

    return { success: true as const, vins: input.vehicles.map((v) => v.vin) };
  }

  private async saveVehicle(
    vehicle: { vin: string; name?: string; priority: number },
  ): Promise<void> {
    await this.deps.upsertVehicleRow({
      id: vehicle.vin,
      name: vehicle.name ?? "Tesla",
      priority: vehicle.priority,
      config: JSON.stringify({}),
      mode: "auto" as const,
    });

    // Register with VehicleManager via deps (idempotent; safe to call each time)
    try {
      const vehicleRow = await this.deps.getVehicleRow(vehicle.vin);
      if (vehicleRow) {
        await this.deps.addVehicle(vehicleRow);
      }
    } catch (err) {
      this.logger.error(
        `Failed to register vehicle ${vehicle.vin} with manager:`,
        err,
      );
    }
  }

  /** Register as a Tesla partner (client_credentials grant + partner_accounts call). */
  async registerPartner(): Promise<{
    success: true;
    message: string;
    data: unknown;
  }> {
    const clientId = await this.deps.getConfig("client_id");
    const clientSecret = await this.deps.getSecret("client_secret");
    const hosting = (await this.deps.getConfig("public_key_hosting")) ?? "";
    const domain = resolvePublicKeyDomain(
      hosting as PublicKeyHosting,
      await this.deps.getConfig("public_key_domain"),
      this.deps.tunnel.getUrl(),
    );

    if (!clientId || !clientSecret) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Tesla client credentials not configured",
      });
    }

    if (!domain) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: hosting === "tunnel"
          ? "Tunnel is not running — start it on the hosting step before registering"
          : "Tesla domain not configured",
      });
    }

    const fleetApiBaseUrl = await this.tokenManager.getFleetApiBaseUrl();

    // Step 1: Get a partner token via client_credentials grant
    const partnerToken = await this.fetchPartnerToken(
      clientId,
      clientSecret,
      fleetApiBaseUrl,
    );

    // Step 2: Register as a partner
    try {
      const registerResponse = await this.io.fetch(
        `${fleetApiBaseUrl}/api/1/partner_accounts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${partnerToken}`,
          },
          body: JSON.stringify({
            domain: domain.replace(/^https?:\/\//, ""),
          }),
        },
      );

      if (!registerResponse.ok) {
        const text = await registerResponse.text();
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            `Partner registration failed: Tesla API returned ${registerResponse.status}: ${text}`,
        });
      }

      const registerData = await registerResponse.json();
      this.logger.info("Partner registration completed");
      return {
        success: true as const,
        message: "Partner registration successful",
        data: registerData,
      };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "Partner registration failed",
        cause: err,
      });
    }
  }

  /** Check if the Tesla proxy is reachable via TCP connect. */
  async checkProxyReachable(): Promise<{
    teslaConfigured: boolean;
    proxyReachable: boolean;
  }> {
    const vehicles = await this.deps.getVehicleRows();
    const hasTesla = vehicles.length > 0;
    if (!hasTesla) {
      return { teslaConfigured: false, proxyReachable: false };
    }
    const proxyUrlStr = (await this.deps.getConfig("proxy_url")) ??
      "https://localhost:4443";
    const proxyUrl = new URL(proxyUrlStr);
    const hostname = proxyUrl.hostname;
    const port = parseInt(proxyUrl.port || "4443", 10);
    try {
      const conn = await this.io.connect({ hostname, port });
      conn.close();
      return { teslaConfigured: true, proxyReachable: true };
    } catch {
      return { teslaConfigured: true, proxyReachable: false };
    }
  }

  private async readChargeLimit(
    vehicleId: string,
    fleetBase: string,
    token: string,
  ): Promise<number | null> {
    const res = await this.io.fetch(
      `${fleetBase}/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=charge_state`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.response?.charge_state?.charge_limit_soc ?? null;
  }

  private async readOrWakeForChargeLimit(
    vehicleId: string,
    fleetBase: string,
    token: string,
  ): Promise<number | null> {
    const direct = await this.readChargeLimit(vehicleId, fleetBase, token);
    if (direct != null) return direct;
    await this.io.fetch(
      `${fleetBase}/api/1/vehicles/${vehicleId}/wake_up`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const attempts = this.io.wakePollAttempts ?? 10;
    const delay = this.io.wakePollDelayMs ?? 3000;
    // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops -- polling loop with early return
    for (const _ of Array.from({ length: attempts })) {
      await sleep(delay);
      const result = await this.readChargeLimit(vehicleId, fleetBase, token);
      if (result != null) return result;
    }
    return null;
  }

  /** Check if the vehicle key has been paired via a no-op signed command. */
  async checkKeyPairing(): Promise<{
    paired: boolean | null;
    error?: string;
  }> {
    const vehicles = await this.deps.getVehicleRows();
    const teslaVehicle = vehicles[0];
    if (!teslaVehicle) {
      return { paired: null, error: "No Tesla vehicle configured" };
    }

    // Read proxy URL from DB config
    const proxyUrl = (await this.deps.getConfig("proxy_url")) ??
      "https://localhost:4443";

    // Check proxy is reachable first
    const proxyUrlParsed = new URL(proxyUrl);
    try {
      const conn = await this.io.connect({
        hostname: proxyUrlParsed.hostname,
        port: parseInt(proxyUrlParsed.port || "4443", 10),
      });
      conn.close();
    } catch {
      return { paired: null, error: "Proxy not reachable" };
    }

    // Read current charge limit, then set it to the same value (no-op signed command).
    // If the vehicle is asleep, wake it and retry.
    try {
      const token = await this.tokenManager.getAccessToken();
      const fleetBase = await this.tokenManager.getFleetApiBaseUrl();
      const chargeLimit = await this.readOrWakeForChargeLimit(
        teslaVehicle.id,
        fleetBase,
        token,
      );

      if (chargeLimit == null) {
        return {
          paired: null,
          error: "Could not read vehicle data after waking",
        };
      }

      const cmdRes = await this.io.fetch(
        `${proxyUrl}/api/1/vehicles/${teslaVehicle.id}/command/set_charge_limit`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ percent: chargeLimit }),
          signal: AbortSignal.timeout(30000),
        },
      );

      if (cmdRes.ok) {
        await this.deps.setConfig("key_paired", "true");
        return { paired: true };
      }

      const body = await cmdRes.json().catch(() => ({}));
      const errorMsg = body.error?.message ?? body.error ?? "";
      if (
        typeof errorMsg === "string" && errorMsg.includes("not been paired")
      ) {
        await this.deps.setConfig("key_paired", "false");
        return {
          paired: false,
          error: "Public key has not been paired with the vehicle",
        };
      }

      return {
        paired: null,
        error: errorMsg || "Could not determine pairing status",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("not been paired")) {
        await this.deps.setConfig("key_paired", "false");
        return {
          paired: false,
          error: "Public key has not been paired with the vehicle",
        };
      }
      return { paired: null, error: "Could not determine pairing status" };
    }
  }

  private async fetchPartnerToken(
    clientId: string,
    clientSecret: string,
    fleetApiBaseUrl: string,
  ): Promise<string> {
    try {
      const tokenResponse = await this.io.fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          audience: fleetApiBaseUrl,
          scope:
            "openid vehicle_device_data vehicle_cmds vehicle_charging_cmds",
        }),
      });

      if (!tokenResponse.ok) {
        const text = await tokenResponse.text();
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            `Failed to obtain partner token: Tesla auth returned ${tokenResponse.status}: ${text}`,
        });
      }

      const tokenData = await tokenResponse.json();
      return tokenData.access_token;
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "Failed to obtain partner token",
        cause: err,
      });
    }
  }
}
