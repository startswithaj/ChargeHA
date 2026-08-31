import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import { createFroniusCloudRouter } from "./router.ts";

// Fronius Cloud energy plugin — manages Solar.web API communication behind
// the EnergyPlugin interface.
export class FroniusCloudPlugin implements EnergyPlugin {
  readonly id = "fronius_cloud";
  readonly displayName = "Fronius (Cloud)";
  readonly vendor = "Fronius";
  readonly settingsComponentKey = "fronius-cloud-config";
  readonly configDef = froniusCloudConfigDef;
  readonly secretKeys = FRONIUS_CLOUD_SECRET_KEYS;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Fronius Cloud plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const email = await this.deps.getConfig("email");
    const password = await this.deps.getSecret("password");
    const pvSystemId = await this.deps.getConfig("pv_system_id");
    if (!email || !password || !pvSystemId) {
      throw new Error("Fronius Cloud credentials incomplete");
    }
    return new FroniusCloudAdapter(email, password, pvSystemId, this.deps.log);
  }

  async testConnection(
    email: string,
    password: string,
    pvSystemId: string,
  ): Promise<
    { success: true; systemName: string } | { success: false; error: string }
  > {
    const adapter = new FroniusCloudAdapter(
      email,
      password,
      pvSystemId,
      this.deps.log,
    );
    try {
      await adapter.connect();
      const deviceInfo = await adapter.getDeviceInfo();
      await adapter.disconnect();
      return { success: true, systemName: deviceInfo.name };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createFroniusCloudRouter(this.deps, this);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
