import type { AnyRouter } from "@trpc/server";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { ChargerRow } from "@chargeha/server/db/types";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  PluginHealthCheck,
  PluginHttpRoutes,
} from "@chargeha/plugins/types";
import { PollingChargerMiddleware } from "../../PollingChargerMiddleware.ts";
import { TAPO_SECRET_KEYS, tapoConfigDef } from "./config.ts";
import { KlapClient } from "./KlapClient.ts";
import { TapoAuthError, TapoLockedError } from "./errors.ts";
import {
  TapoChargerAdapter,
  type TapoEnergyUsage,
} from "./TapoChargerAdapter.ts";
import { createTapoRouter } from "./router.ts";

const numberConfig = (raw: string | null, fallback: number): number => {
  const parsed = parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const describeTapoError = (error: unknown): string => {
  if (error instanceof TapoAuthError) {
    return "Tapo credentials rejected — check email and password";
  }
  // A firmware update can re-lock a plug that was working, so this reaches the
  // health check, not just first-time setup.
  if (error instanceof TapoLockedError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/** Tapo smart plug charger plugin — switch-only control of a dumb EVSE via
 *  the local KLAP protocol. */
export class TapoChargerPlugin implements ChargerPlugin {
  readonly id = "tapo";
  readonly displayName = "Tapo P110/115 Smart Plug";
  readonly vendor = "TP-Link";
  readonly settingsComponentKey = "tapo-settings";
  readonly configDef = tapoConfigDef;
  readonly secretKeys = TAPO_SECRET_KEYS;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Tapo plugin initialized");
  }

  async createChargerMiddleware(row: ChargerRow): Promise<ChargerMiddleware> {
    const [host, email, password] = await Promise.all([
      this.deps.getConfig("host"),
      this.deps.getConfig("email"),
      this.deps.getSecret("password"),
    ]);
    if (!host) throw new Error("Tapo host not configured");
    if (!email || !password) {
      throw new Error("Tapo account credentials not configured");
    }
    const [amps, threshold, poll, stale] = await Promise.all([
      this.deps.getConfig("fixed_draw_amps"),
      this.deps.getConfig("detection_threshold_w"),
      this.deps.getConfig("poll_interval_seconds"),
      this.deps.getConfig("stale_timeout_seconds"),
    ]);
    const adapter = new TapoChargerAdapter(
      {
        chargerId: row.id,
        fixedDrawAmps: numberConfig(amps, 10),
        detectionThresholdW: numberConfig(threshold, 100),
        pollSeconds: numberConfig(poll, 10),
        staleTimeoutSeconds: numberConfig(stale, 60),
      },
      new KlapClient(host, email, password, this.deps.log),
      this.deps.log,
    );
    return new PollingChargerMiddleware(adapter, this.deps.log);
  }

  getRouter(): AnyRouter {
    return createTapoRouter(this.deps);
  }

  getChargerHttpRoutes(): PluginHttpRoutes | null {
    return null;
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [{
      name: "tapo-connection",
      timeoutMs: 8000,
      warningTitle: "Tapo plug unreachable",
      warningMessage:
        "ChargeHA cannot reach the Tapo smart plug. Charging cannot be " +
        "controlled until it is back online.",
      run: async () => {
        const host = await this.deps.getConfig("host");
        if (!host) return { status: "ok" }; // unconfigured — stay silent
        const [email, password] = await Promise.all([
          this.deps.getConfig("email"),
          this.deps.getSecret("password"),
        ]);
        if (!email || !password) {
          return {
            status: "error",
            message: "Tapo credentials not configured",
          };
        }
        try {
          const client = new KlapClient(host, email, password, this.deps.log);
          await client.handshake();
          await client.request<TapoEnergyUsage>("get_energy_usage");
          return { status: "ok" };
        } catch (error) {
          return { status: "error", message: describeTapoError(error) };
        }
      },
    }];
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
