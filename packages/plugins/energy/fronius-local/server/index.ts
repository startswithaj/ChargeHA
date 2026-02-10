import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin } from "@chargeha/plugins/types";
import { froniusLocalConfigDef } from "./config.ts";
import { FroniusLocalAdapter } from "./FroniusLocalAdapter.ts";
import { froniusLocalRouter } from "./router.ts";

/**
 * Fronius Local energy plugin — manages local network inverter communication
 * behind the EnergyPlugin interface.
 */
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

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return froniusLocalRouter;
  }
}
