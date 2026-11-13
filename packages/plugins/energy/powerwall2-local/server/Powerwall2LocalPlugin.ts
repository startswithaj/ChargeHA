import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { safePowerwallError } from "./errors.ts";
import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import {
  parseMaxStalenessSeconds,
  parsePollIntervalSeconds,
  POWERWALL2_LOCAL_SECRET_KEYS,
  type Powerwall2LocalConfig,
  powerwall2LocalConfigDef,
} from "./config.ts";
import { PowerwallGatewayClient } from "./PowerwallGatewayClient.ts";
import { Powerwall2LocalAdapter } from "./Powerwall2LocalAdapter.ts";
import { createPowerwall2LocalRouter } from "./router.ts";

export class Powerwall2LocalPlugin implements EnergyPlugin {
  readonly id = "powerwall2_local";
  readonly displayName = "Tesla Powerwall 2 via Gateway (Local)";
  readonly vendor = "Tesla";
  readonly settingsComponentKey = "powerwall2-local-config";
  readonly configDef = powerwall2LocalConfigDef;
  readonly secretKeys = POWERWALL2_LOCAL_SECRET_KEYS;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Tesla Powerwall 2 via Gateway (Local) plugin initialized");
  }

  async createAdapter(
    input?: Powerwall2LocalConfig,
    dbLog: PluginDbLogger = this.deps.dbLog,
  ): Promise<EnergySourceAdapter> {
    const host = input?.host ?? await this.deps.getConfig("host");
    const email = input?.email ?? await this.deps.getConfig("email") ?? "";
    const password = input?.password ?? await this.deps.getSecret("password") ??
      "";
    const freshness = input?.maxStalenessSeconds ??
      await this.deps.getConfig("max_staleness_seconds");
    const interval = input?.pollIntervalSeconds ??
      await this.deps.getConfig("poll_interval_seconds");
    if (!host) throw new Error("Powerwall Gateway host is not configured");
    return new Powerwall2LocalAdapter(
      new PowerwallGatewayClient(host, email, password),
      parseMaxStalenessSeconds(freshness),
      this.deps.log,
      Date.now,
      parsePollIntervalSeconds(interval),
      dbLog,
    );
  }

  async testConnection(input: Powerwall2LocalConfig) {
    // Interactive test — results go to the caller, not the Logs page.
    const noopDbLog = new PluginDbLogger(
      () => Promise.resolve(),
      this.deps.log,
    );
    try {
      const adapter = await this.createAdapter(input, noopDbLog);
      try {
        const device = await adapter.getDeviceInfo();
        const realtime = await adapter.getRealtimeData();
        return { success: true as const, device, realtime };
      } finally {
        await adapter.disconnect();
      }
    } catch (error) {
      return {
        success: false as const,
        error: safePowerwallError(error).message,
      };
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createPowerwall2LocalRouter(this.deps, this);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
