import type { AnyRouter } from "@trpc/server";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { ChargerRow } from "@chargeha/shared";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  ChargerRowConfig,
  PluginHealthCheck,
  PluginHttpRoutes,
  ResolvedChargerRow,
} from "@chargeha/shared/plugins";
import { PollingChargerMiddleware } from "../../PollingChargerMiddleware.ts";
import { TAPO_SECRET_KEYS, tapoConfigDef } from "./config.ts";
import { KlapClient } from "./KlapClient.ts";
import { TapoAuthError, TapoLockedError } from "./errors.ts";
import {
  TapoChargerAdapter,
  type TapoEnergyUsage,
} from "./TapoChargerAdapter.ts";
import { createTapoRouter } from "./router.ts";

const numberConfig = (raw: string | undefined, fallback: number): number => {
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

interface TapoCredentials {
  host: string;
  email: string;
  password: string;
}

// Per-row plug credentials (config host/email + encrypted password), or a message naming what is missing.
export function tapoCredentials(
  { config, secrets }: ChargerRowConfig,
): TapoCredentials | { error: string } {
  const { host, email } = config;
  const password = secrets.password;
  if (!host) return { error: "Tapo host not configured" };
  if (!email || !password) {
    return { error: "Tapo account credentials not configured" };
  }
  return { host, email, password };
}

// Tapo smart plug charger plugin — switch-only control of a dumb EVSE via
// the local KLAP protocol.
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

  // Nothing is awaited: every value this needs arrives as an argument.
  // deno-lint-ignore require-await
  async createChargerMiddleware(
    row: ChargerRow,
    resolved: ChargerRowConfig,
  ): Promise<ChargerMiddleware> {
    const credentials = tapoCredentials(resolved);
    if ("error" in credentials) throw new Error(credentials.error);
    const { config } = resolved;
    const adapter = new TapoChargerAdapter(
      {
        chargerId: row.id,
        fixedDrawAmps: numberConfig(config.fixed_draw_amps, 10),
        detectionThresholdW: numberConfig(config.detection_threshold_w, 100),
        pollSeconds: numberConfig(config.poll_interval_seconds, 10),
        staleTimeoutSeconds: numberConfig(config.stale_timeout_seconds, 60),
      },
      new KlapClient(
        credentials.host,
        credentials.email,
        credentials.password,
        this.deps.log,
        this.deps.dbLog,
        row.id,
      ),
      this.deps.log,
      this.deps.dbLog,
    );
    return new PollingChargerMiddleware(adapter, this.deps.log);
  }

  getRouter(): AnyRouter {
    return createTapoRouter(this.deps);
  }

  getChargerHttpRoutes(): PluginHttpRoutes | null {
    return null;
  }

  // null = healthy, or unconfigured and therefore deliberately silent.
  private async checkRow(entry: ResolvedChargerRow): Promise<string | null> {
    const credentials = tapoCredentials(entry);
    if ("error" in credentials) {
      // No host at all means the row was never set up — stay silent rather
      // than nag about a charger the user has not finished adding. A host
      // with missing credentials IS worth reporting.
      return entry.config.host
        ? `${entry.row.name}: ${credentials.error}`
        : null;
    }
    try {
      const client = new KlapClient(
        credentials.host,
        credentials.email,
        credentials.password,
        this.deps.log,
        this.deps.dbLog,
        entry.row.id,
      );
      await client.handshake();
      await client.request<TapoEnergyUsage>("get_energy_usage");
      return null;
    } catch (error) {
      return `${entry.row.name}: ${describeTapoError(error)}`;
    }
  }

  getHealthChecks(): PluginHealthCheck[] {
    // One check covering every Tapo row rather than one check per row: the
    // check list is built once at boot and its `name` is a stable identifier,
    // so it cannot grow and shrink as chargers are added. Failures are named
    // in the message instead.
    return [{
      name: "tapo-connection",
      timeoutMs: 8000,
      warningTitle: "Tapo plug unreachable",
      warningMessage:
        "ChargeHA cannot reach the Tapo smart plug. Charging cannot be " +
        "controlled until it is back online.",
      run: async () => {
        const entries = await this.deps.resolveChargerConfigs();
        const results = await Promise.all(
          entries.map((entry) => this.checkRow(entry)),
        );
        const failures = results.filter((r): r is string => r !== null);
        return failures.length === 0
          ? { status: "ok" }
          : { status: "error", message: failures.join("; ") };
      },
    }];
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
