import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin } from "@chargeha/plugins/types";
import { sigenergyConfigDef } from "./config.ts";
import { SigenergyAdapter } from "./SigenergyAdapter.ts";
import { JsmodbusReader } from "./SigenergyModbusClient.ts";
import { sigenergyRouter } from "./router.ts";

/**
 * Sigenergy energy plugin — reads a Sigenergy inverter / energy-storage system
 * on the local network over Modbus TCP (no authentication).
 */
export class SigenergyPlugin implements EnergyPlugin {
  readonly id = "sigenergy";
  readonly displayName = "Sigenergy";
  readonly vendor = "Sigenergy";
  readonly settingsComponentKey = "sigenergy-config";
  readonly configDef = sigenergyConfigDef;
  readonly secretKeys: readonly string[] = [];

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Sigenergy plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const host = await this.deps.getConfig("host");
    if (!host) {
      throw new Error("Sigenergy host not configured");
    }
    const port = parseInt((await this.deps.getConfig("port")) ?? "502", 10);
    const plantUnitId = parseInt(
      (await this.deps.getConfig("plant_unit_id")) ?? "247",
      10,
    );
    const deviceUnitId = parseInt(
      (await this.deps.getConfig("device_unit_id")) ?? "1",
      10,
    );

    const reader = new JsmodbusReader(
      host,
      port,
      [plantUnitId, deviceUnitId],
      this.deps.log,
    );
    return new SigenergyAdapter(
      reader,
      plantUnitId,
      deviceUnitId,
      this.deps.log,
    );
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return sigenergyRouter;
  }
}
