import type { AnyRouter } from "@trpc/server";
import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import { SIGENERGY_DEFAULTS, sigenergyLocalConfigDef } from "./config.ts";
import { SigenergyLocalAdapter } from "./SigenergyLocalAdapter.ts";
import { JsmodbusReader } from "./SigenergyModbusClient.ts";
import { createSigenergyLocalRouter } from "./router.ts";

// Sigenergy energy plugin — reads a Sigenergy inverter / energy-storage
// system on the local network over Modbus TCP (no authentication).
export class SigenergyLocalPlugin implements EnergyPlugin {
  readonly id = "sigenergy_local";
  readonly displayName = "Sigenergy (Local)";
  readonly vendor = "Sigenergy";
  readonly settingsComponentKey = "sigenergy-local-config";
  readonly configDef = sigenergyLocalConfigDef;
  readonly secretKeys: readonly string[] = [];

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Sigenergy plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const host = await this.deps.getConfig("host");
    if (!host) {
      throw new Error("Sigenergy host not configured");
    }
    const port = parseInt(
      (await this.deps.getConfig("port")) ?? String(SIGENERGY_DEFAULTS.port),
      10,
    );
    const plantUnitId = parseInt(
      (await this.deps.getConfig("plant_unit_id")) ??
        String(SIGENERGY_DEFAULTS.plantUnitId),
      10,
    );
    const deviceUnitId = parseInt(
      (await this.deps.getConfig("device_unit_id")) ??
        String(SIGENERGY_DEFAULTS.deviceUnitId),
      10,
    );

    return this.buildAdapter(host, port, plantUnitId, deviceUnitId);
  }

  private buildAdapter(
    host: string,
    port: number,
    plantUnitId: number,
    deviceUnitId: number,
  ): SigenergyLocalAdapter {
    const reader = new JsmodbusReader(
      host,
      port,
      [plantUnitId, deviceUnitId],
      this.deps.log,
    );
    return new SigenergyLocalAdapter(
      reader,
      plantUnitId,
      deviceUnitId,
      this.deps.log,
    );
  }

  async testConnection(
    config: {
      host: string;
      port: number;
      plantUnitId: number;
      deviceUnitId: number;
    },
  ): Promise<
    | { success: true; device: DeviceInfo; realtime: EnergyData }
    | { success: false; error: string }
  > {
    const adapter = this.buildAdapter(
      config.host,
      config.port,
      config.plantUnitId,
      config.deviceUnitId,
    );
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
    } finally {
      await adapter.disconnect();
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createSigenergyLocalRouter(this.deps, this);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
