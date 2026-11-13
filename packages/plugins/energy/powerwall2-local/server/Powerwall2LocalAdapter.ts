import { PowerwallTelemetryError, safePowerwallError } from "./errors.ts";
import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PowerwallGatewayApi } from "./PowerwallGatewayClient.ts";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { DEFAULT_POWERWALL_POLL_INTERVAL_SECONDS } from "./config.ts";

const AGGREGATES_PATH = "/api/meters/aggregates";
const SOE_PATH = "/api/system_status/soe";
const SOC_BUFFER_PERCENT = 5;
const SOC_USABLE_FRACTION = (100 - SOC_BUFFER_PERCENT) / 100;

type JsonRecord = Record<string, unknown>;

const recordAt = (value: unknown, label: string): JsonRecord => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  throw new PowerwallTelemetryError(`Powerwall telemetry is missing ${label}`);
};

const numberAt = (value: unknown, label: string): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new PowerwallTelemetryError(`Powerwall telemetry has invalid ${label}`);
};

const optionalNumberAt = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const powerAt = (meter: JsonRecord, label: string): number =>
  numberAt(
    meter.instant_power ?? meter.instantaneous_power,
    `${label}.instant_power`,
  );

const timestampAt = (meter: JsonRecord, label: string): number => {
  const raw = meter.last_communication_time;
  const parsed = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new PowerwallTelemetryError(
      `Powerwall telemetry has invalid ${label} timestamp`,
    );
  }
  return parsed;
};

const usableSoc = (value: number): number => {
  if (value < 0 || value > 100) {
    throw new PowerwallTelemetryError(
      "Powerwall telemetry has invalid battery state of charge",
    );
  }
  // The local SOE includes Tesla's 5% buffer, unlike the app's usable SOC.
  // Source: https://github.com/jasonacox/pypowerwall/blob/main/API.md#power-and-energy
  // This buffer is separate from the owner's configurable backup reserve.
  return Math.max(
    0,
    Math.min(100, (value - SOC_BUFFER_PERCENT) / SOC_USABLE_FRACTION),
  );
};

interface MeterSet {
  site: JsonRecord;
  solar: JsonRecord;
  load: JsonRecord;
  battery: JsonRecord;
}

const metersFrom = (raw: unknown): MeterSet => {
  const aggregates = recordAt(raw, "meter aggregates");
  return {
    site: recordAt(aggregates.site, "site meter"),
    solar: recordAt(aggregates.solar, "solar meter"),
    load: recordAt(aggregates.load, "load meter"),
    battery: recordAt(aggregates.battery, "battery meter"),
  };
};

const assertFresh = (
  meters: MeterSet,
  nowMs: number,
  maxStalenessSeconds: number,
): void => {
  const timestamps = [
    timestampAt(meters.site, "site"),
    timestampAt(meters.solar, "solar"),
    timestampAt(meters.load, "load"),
    timestampAt(meters.battery, "battery"),
  ];
  if (Math.max(...timestamps) > nowMs + 5_000) {
    throw new PowerwallTelemetryError(
      "Powerwall telemetry timestamp is in the future; check Gateway and server clocks",
    );
  }
  const oldest = Math.min(...timestamps);
  const ageSeconds = Math.max(0, nowMs - oldest) / 1000;
  if (ageSeconds > maxStalenessSeconds) {
    throw new PowerwallTelemetryError(
      `Powerwall telemetry is stale (${
        Math.round(ageSeconds)
      }s old; limit ${maxStalenessSeconds}s)`,
    );
  }
};

const batterySocFrom = (raw: unknown): number => {
  const soe = recordAt(raw, "battery state of charge");
  return usableSoc(numberAt(soe.percentage, "battery percentage"));
};

const gridVoltageFrom = (site: JsonRecord): number | null =>
  optionalNumberAt(
    site.instant_average_voltage ?? site.instantaneous_average_voltage,
  );

export class Powerwall2LocalAdapter implements EnergySourceAdapter {
  private lastFailureAt: number | null = null;
  constructor(
    private readonly client: PowerwallGatewayApi,
    private readonly maxStalenessSeconds: number,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
    private readonly intervalSeconds = DEFAULT_POWERWALL_POLL_INTERVAL_SECONDS,
    private readonly dbLog?: PluginDbLogger,
  ) {}

  pollIntervalSeconds(): number {
    return this.intervalSeconds;
  }

  async connect(): Promise<void> {
    try {
      const device = await this.getDeviceInfo();
      await this.readTelemetry();
      this.logger.info(
        `Connected to ${device.name} at ${this.client.host} (${device.model})`,
      );
    } catch (error) {
      await this.recordFailure();
      throw safePowerwallError(error);
    }
  }

  disconnect(): Promise<void> {
    // The poller cancels and drains reads before disconnecting the adapter.
    this.client.clearSession();
    return Promise.resolve();
  }

  async getRealtimeData(signal?: AbortSignal): Promise<EnergyData> {
    try {
      const data = await this.readTelemetry(signal);
      this.lastFailureAt = null;
      return data;
    } catch (error) {
      if (signal?.aborted) {
        throw new PowerwallTelemetryError("Powerwall request cancelled");
      }
      throw safePowerwallError(error);
    }
  }

  private async recordFailure(): Promise<void> {
    const now = this.now();
    if (this.lastFailureAt !== null && now - this.lastFailureAt < 300_000) {
      return;
    }
    this.lastFailureAt = now;
    // Never persist response bodies, credentials or transport error text.
    await this.dbLog?.error(
      "Powerwall connection failed; check connection and credentials",
    );
  }

  private async readTelemetry(signal?: AbortSignal): Promise<EnergyData> {
    signal?.throwIfAborted();
    const aggregates = await this.client.getJson(AGGREGATES_PATH, signal);
    signal?.throwIfAborted();
    const soe = await this.client.getJson(SOE_PATH, signal);
    signal?.throwIfAborted();
    const meters = metersFrom(aggregates);
    const nowMs = this.now();
    assertFresh(meters, nowMs, this.maxStalenessSeconds);

    return {
      solarProductionW: Math.max(0, Math.round(powerAt(meters.solar, "solar"))),
      gridPowerW: Math.round(powerAt(meters.site, "site")),
      homeConsumptionW: Math.max(0, Math.round(powerAt(meters.load, "load"))),
      batteryPowerW: Math.round(powerAt(meters.battery, "battery")),
      batterySoc: batterySocFrom(soe),
      gridVoltageV: gridVoltageFrom(meters.site),
      lastUpdated: new Date(nowMs).toISOString(),
    };
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const status = recordAt(await this.client.getStatus(), "gateway status");
    const din = typeof status.din === "string" ? status.din : this.client.host;
    const version = typeof status.version === "string"
      ? status.version
      : "Unknown firmware";
    return {
      id: din,
      name: "Tesla Powerwall 2 via Gateway (Local)",
      manufacturer: "Tesla",
      model: version,
    };
  }
}
