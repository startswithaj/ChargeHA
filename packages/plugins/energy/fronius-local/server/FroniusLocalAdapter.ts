import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";

export class FroniusConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "FroniusConnectionError";
  }
}

export class FroniusParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FroniusParseError";
  }
}

export class FroniusLocalAdapter implements EnergySourceAdapter {
  pollIntervalSeconds(): number {
    return 10;
  }

  private host: string;
  private meterDeviceId: number;
  private baseUrl: string;
  private logger: Logger;

  constructor(host: string, meterDeviceId = 0, logger: Logger) {
    this.host = host;
    this.meterDeviceId = meterDeviceId;
    this.baseUrl = `http://${host}`;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    try {
      const response = await fetch(
        `${this.baseUrl}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) {
        throw new FroniusConnectionError(
          `Fronius returned HTTP ${response.status}`,
        );
      }
      this.logger.info(`Connected to inverter at ${this.host}`);
    } catch (error) {
      if (error instanceof FroniusConnectionError) throw error;
      throw new FroniusConnectionError(
        `Cannot reach Fronius inverter at ${this.host}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection to clean up
  }

  async getRealtimeData(): Promise<EnergyData> {
    const [powerFlowRes, meterRes] = await Promise.all([
      this.fetch("/solar_api/v1/GetPowerFlowRealtimeData.fcgi"),
      this.fetch(
        `/solar_api/v1/GetMeterRealtimeData.cgi?Scope=Device&DeviceId=${this.meterDeviceId}`,
      ),
    ]);

    const json = await powerFlowRes.json();
    const site = json?.Body?.Data?.Site;
    if (!site) {
      throw new FroniusParseError(
        "Missing Body.Data.Site in PowerFlow response",
      );
    }

    const meterJson = await meterRes.json();
    const meterData = meterJson?.Body?.Data;
    const gridVoltageV = meterData?.Voltage_AC_Phase_1 ?? null;

    return {
      solarProductionW: site.P_PV ?? 0,
      gridPowerW: site.P_Grid ?? 0,
      homeConsumptionW: Math.abs(site.P_Load ?? 0),
      batteryPowerW: site.P_Akku ?? null,
      batterySoc: site.SOC ?? null,
      gridVoltageV,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const response = await this.fetch(
      "/solar_api/v1/GetInverterInfo.cgi",
    );
    const json = await response.json();

    const inverters = json?.Body?.Data;
    if (!inverters) {
      throw new FroniusParseError(
        "Missing Body.Data in InverterInfo response",
      );
    }

    // Take the first inverter
    const firstId = Object.keys(inverters)[0];
    const info = inverters[firstId];

    return {
      id: firstId ?? "unknown",
      name: info?.CustomName ?? "Fronius Inverter",
      manufacturer: "Fronius",
      model: info?.DT?.toString() ?? "Unknown",
    };
  }

  private async fetch(path: string): Promise<Response> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new FroniusConnectionError(
          `Fronius returned HTTP ${response.status} for ${path}`,
        );
      }
      return response;
    } catch (error) {
      if (
        error instanceof FroniusConnectionError ||
        error instanceof FroniusParseError
      ) {
        throw error;
      }
      throw new FroniusConnectionError(
        `Failed to fetch ${path} from Fronius at ${this.host}`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
