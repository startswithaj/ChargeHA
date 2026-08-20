import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import {
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
} from "../errors.ts";
import { SemsPlusClient } from "./SemsPlusClient.ts";
import { toEnergyDataFromFlow } from "./mapping.ts";

const POLL_INTERVAL_SECONDS = 60;

const MAX_STALE_MS = 15 * 60 * 1000;

// Backoff windows outlive adapter instances: a config save rebuilds the
// adapter, and a fresh instance must not call SEMS+ inside a declared window.
const backoffUntilByStation = new Map<string, number>();

export function resetSemsPlusBackoffForTests(): void {
  backoffUntilByStation.clear();
}

export class SemsPlusAdapter implements EnergySourceAdapter {
  private lastGood: EnergyData | null = null;
  private lastGoodAtMs = 0;

  constructor(
    private readonly client: SemsPlusClient,
    private readonly stationId: string,
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
  ) {}

  static create(
    account: string,
    password: string,
    stationId: string,
    logger: Logger,
    dbLog: PluginDbLogger,
  ): SemsPlusAdapter {
    return new SemsPlusAdapter(
      new SemsPlusClient(account, password, logger, dbLog),
      stationId,
      logger,
      dbLog,
    );
  }

  pollIntervalSeconds(): number {
    return POLL_INTERVAL_SECONDS;
  }

  async connect(): Promise<void> {
    const flow = await this.guarded(() => this.client.getFlow(this.stationId));
    this.logger.info(`Connected to SEMS+ station ${this.stationId}`);
    // Seed the cache so a rate limit on the first poll serves data instead
    // of throwing.
    this.remember(toEnergyDataFromFlow(flow));
  }

  // Backoff deliberately survives disconnect: lifecycle churn must not erase
  // a rate-limit window SEMS+ has declared.
  disconnect(): Promise<void> {
    this.client.clearSession();
    this.lastGood = null;
    this.lastGoodAtMs = 0;
    return Promise.resolve();
  }

  async getRealtimeData(): Promise<EnergyData> {
    // Calling during a backoff window is what escalates a throttle into a
    // block, so serve cache without touching the network.
    if (this.isBackingOff()) return this.serveCached();

    try {
      const flow = await this.guarded(() =>
        this.client.getFlow(this.stationId)
      );
      const data = this.remember(toEnergyDataFromFlow(flow));
      this.logger.info(
        `SEMS+ flow: solar=${data.solarProductionW}W grid=${data.gridPowerW}W home=${data.homeConsumptionW}W battery=${data.batteryPowerW}W soc=${data.batterySoc} (raw pAc=${flow.pAc} pSystem=${flow.pSystem} pGrid=${flow.pGrid} pConsum=${flow.pConsum} pBat=${flow.pBat} refreshTime=${flow.refreshTime})`,
      );
      return data;
    } catch (error) {
      if (error instanceof GoodweSemsRateLimitError) return this.serveCached();
      throw error;
    }
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const flow = await this.guarded(() => this.client.getFlow(this.stationId));
    return {
      id: this.stationId,
      name: flow.name ?? "GoodWe SEMS+",
      manufacturer: "GoodWe",
      model: "SEMS+",
    };
  }

  private backoffUntilMs(): number {
    return backoffUntilByStation.get(this.stationId) ?? 0;
  }

  private isBackingOff(): boolean {
    return Date.now() < this.backoffUntilMs();
  }

  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    if (this.isBackingOff()) {
      throw new GoodweSemsRateLimitError(this.backoffUntilMs() - Date.now());
    }
    try {
      return await call();
    } catch (error) {
      if (error instanceof GoodweSemsRateLimitError) {
        backoffUntilByStation.set(
          this.stationId,
          Date.now() + error.retryAfterMs,
        );
        const message = `SEMS+ rate limited — pausing requests for ${
          Math.round(error.retryAfterMs / 1000)
        }s`;
        this.logger.warn(message);
        this.dbLog.warn(message, { payload: { stationId: this.stationId } });
      }
      throw error;
    }
  }

  private remember(data: EnergyData): EnergyData {
    this.lastGood = data;
    this.lastGoodAtMs = Date.now();
    return data;
  }

  // Keeps the original timestamp — restamping would record a backoff window as
  // a run of fresh readings.
  private serveCached(): EnergyData {
    const age = Date.now() - this.lastGoodAtMs;
    if (!this.lastGood || age > MAX_STALE_MS) {
      throw new GoodweSemsConnectionError(
        "SEMS+ is rate limiting and no recent reading is available",
      );
    }
    return { ...this.lastGood };
  }
}
