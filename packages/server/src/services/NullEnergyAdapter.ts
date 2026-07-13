import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "../lib/Logger.ts";

/** No-op adapter used when no energy source is configured yet. */
export class NullEnergyAdapter implements EnergySourceAdapter {
  pollIntervalSeconds(): number {
    return 30;
  }
  private logger: Logger;
  private hasLogged = false;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  connect(): Promise<void> {
    if (!this.hasLogged) {
      this.logger.info("Null energy adapter active — no inverter configured");
      this.hasLogged = true;
    }
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  getRealtimeData(): Promise<EnergyData> {
    return Promise.resolve({
      solarProductionW: 0,
      gridPowerW: 0,
      homeConsumptionW: 0,
      batteryPowerW: null,
      batterySoc: null,
      gridVoltageV: null,
      lastUpdated: new Date().toISOString(),
    });
  }

  getDeviceInfo(): Promise<DeviceInfo> {
    return Promise.resolve({
      id: "none",
      name: "No energy source configured",
      manufacturer: "",
      model: "",
    });
  }
}
