import type { AnyRouter } from "@trpc/server";
import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import { froniusLocalConfigDef } from "./config.ts";
import { FroniusLocalAdapter } from "./FroniusLocalAdapter.ts";
import { createFroniusLocalRouter } from "./router.ts";

export class FroniusLocalPlugin implements EnergyPlugin {
  readonly id = "fronius_local";
  readonly displayName = "Fronius (Local)";
  readonly vendor = "Fronius";
  readonly settingsComponentKey = "fronius-local-config";
  readonly configDef = froniusLocalConfigDef;
  readonly secretKeys: readonly string[] = [];

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Fronius Local plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const host = await this.deps.getConfig("host");
    const meterRaw = await this.deps.getConfig("meter_device_id");
    const meterDeviceId = parseInt(meterRaw ?? "0", 10);
    if (!host) {
      throw new Error("Fronius local host not configured");
    }
    return new FroniusLocalAdapter(host, meterDeviceId, this.deps.log);
  }

  async testConnection(
    host: string,
    meterDeviceId: number,
  ): Promise<
    | { success: true; device: DeviceInfo; realtime: EnergyData }
    | { success: false; error: string }
  > {
    const adapter = new FroniusLocalAdapter(host, meterDeviceId, this.deps.log);
    try {
      await adapter.connect();
      const [device, realtime] = await Promise.all([
        adapter.getDeviceInfo(),
        adapter.getRealtimeData(),
      ]);
      return { success: true, device, realtime };
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
    return createFroniusLocalRouter(this.deps, this);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
