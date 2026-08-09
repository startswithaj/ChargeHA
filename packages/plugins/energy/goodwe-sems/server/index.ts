import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import { GOODWE_SEMS_SECRET_KEYS, goodweSemsConfigDef } from "./config.ts";
import { GoodweSemsAdapter } from "./GoodweSemsAdapter.ts";
import { createGoodweSemsRouter } from "./router.ts";

/** GoodWe SEMS Portal energy plugin — cloud readings for GoodWe inverters
 *  paired with a HomeKit or smart meter. */
export class GoodweSemsPlugin implements EnergyPlugin {
  readonly id = "goodwe_sems";
  readonly displayName = "GoodWe (Cloud / SEMS Portal)";
  readonly vendor = "GoodWe";
  readonly settingsComponentKey = "goodwe-sems-config";
  readonly configDef = goodweSemsConfigDef;
  readonly secretKeys = GOODWE_SEMS_SECRET_KEYS;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("GoodWe SEMS plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const account = await this.deps.getConfig("account");
    const password = await this.deps.getSecret("password");
    const stationId = await this.deps.getConfig("station_id");
    if (!account || !password || !stationId) {
      throw new Error("GoodWe SEMS credentials incomplete");
    }
    return GoodweSemsAdapter.create(
      account,
      password,
      stationId,
      this.deps.log,
    );
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createGoodweSemsRouter(this.deps);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
