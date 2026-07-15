import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/plugins/types";
import { ENPHASE_LOCAL_SECRET_KEYS, enphaseLocalConfigDef } from "./config.ts";
import { EnphaseClient } from "./EnphaseClient.ts";
import { EnphaseLocalAdapter } from "./EnphaseLocalAdapter.ts";
import { createEnphaseLocalRouter } from "./router.ts";

/**
 * Enphase Local energy plugin — reads an Enphase Envoy / IQ Gateway
 * (firmware 7+) on the local network over its token-authenticated HTTPS API.
 */
export class EnphaseLocalPlugin implements EnergyPlugin {
  readonly id = "enphase_local";
  readonly displayName = "Enphase (Local)";
  readonly vendor = "Enphase";
  readonly settingsComponentKey = "enphase-local-config";
  readonly configDef = enphaseLocalConfigDef;
  readonly secretKeys = ENPHASE_LOCAL_SECRET_KEYS;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Enphase Local plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const host = await this.deps.getConfig("host");
    if (!host) {
      throw new Error("Enphase host not configured");
    }
    const email = (await this.deps.getConfig("email")) ?? "";
    const password = (await this.deps.getSecret("password")) ?? "";
    const token = (await this.deps.getSecret("token")) ?? "";

    const client = new EnphaseClient(
      host,
      {
        email,
        password,
        // A token saved by the wizard's credentials flow is a cached owner
        // token (renewable); treat it as manual only when no credentials
        // exist to renew it with.
        manualToken: email && password ? "" : token,
        cachedToken: email && password ? token : "",
      },
      (fresh) => this.deps.setSecret("token", fresh),
      this.deps.log,
    );
    return new EnphaseLocalAdapter(client, this.deps.log, this.deps.dbLog);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createEnphaseLocalRouter(this.deps);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
