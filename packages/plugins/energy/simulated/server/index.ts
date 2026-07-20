import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/plugins/types";
import { simulatedEnergyConfigDef } from "./config.ts";
import { SimulatedEnergyAdapter } from "./SimulatedEnergyAdapter.ts";
import { createSimulatedEnergyRouter } from "./router.ts";

/**
 * Simulated energy plugin — generates a solar/home/grid curve with no hardware,
 * for testing and demo use.
 */
export class SimulatedEnergyPlugin implements EnergyPlugin {
  readonly id = "simulated_energy";
  readonly displayName = "Simulated";
  readonly vendor = "ChargeHA";
  readonly settingsComponentKey = "simulated-energy-config";
  readonly configDef = simulatedEnergyConfigDef;
  readonly secretKeys: readonly string[] = [];

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Simulated Energy plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    return new SimulatedEnergyAdapter({
      peakKw: parseFloat(await this.deps.getConfig("peak_kw") ?? "8"),
      cloudiness: parseFloat(await this.deps.getConfig("cloudiness") ?? "30"),
      storms: parseInt(await this.deps.getConfig("storms") ?? "0", 10),
      homeBaseW: parseFloat(await this.deps.getConfig("home_base_w") ?? "1500"),
      sunrise: parseFloat(await this.deps.getConfig("sunrise") ?? "6.5"),
      sunset: parseFloat(await this.deps.getConfig("sunset") ?? "18"),
      seed: parseInt(await this.deps.getConfig("seed") ?? "69", 10),
    }, this.deps.log);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createSimulatedEnergyRouter(this.deps);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
