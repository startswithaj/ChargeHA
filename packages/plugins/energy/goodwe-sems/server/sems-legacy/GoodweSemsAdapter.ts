import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import {
  GoodweSemsClient,
  type GoodweSemsStationReader,
  type SemsPowerflow,
} from "./GoodweSemsClient.ts";
import {
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
} from "../errors.ts";
import {
  isImpossibleExport,
  parseSemsValue,
  toEnergyDataFromDetail,
} from "./GoodweSemsMapping.ts";

const POLL_INTERVAL_SECONDS = 60;

const MAX_STALE_MS = 15 * 60 * 1000;

// Backoff windows outlive adapter instances: a config save rebuilds the
// adapter, and a fresh instance must not call SEMS inside a declared window.
const backoffUntilByStation = new Map<string, number>();

export function resetSemsBackoffForTests(): void {
  backoffUntilByStation.clear();
}

export class GoodweSemsAdapter implements EnergySourceAdapter {
  private lastGood: EnergyData | null = null;
  private lastGoodAtMs = 0;
  private gridDirectionUnknown = false;

  constructor(
    private readonly client: GoodweSemsStationReader,
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
  ): GoodweSemsAdapter {
    return new GoodweSemsAdapter(
      new GoodweSemsClient(account, password, logger, dbLog),
      stationId,
      logger,
      dbLog,
    );
  }

  pollIntervalSeconds(): number {
    return POLL_INTERVAL_SECONDS;
  }

  async connect(): Promise<void> {
    const detail = await this.guarded(() => {
      return this.client.getStationDetail(this.stationId);
    });
    if (!detail.hasPowerflow) {
      throw new GoodweSemsConnectionError(
        "SEMS station reports no power flow data — a GoodWe HomeKit or smart " +
          "meter is required for grid and consumption readings",
      );
    }
    this.logger.info(`Connected to SEMS station ${this.stationId}`);
    const flow = detail.powerflow;
    if (flow) {
      // Seed the cache so a rate limit on the first poll serves data instead
      // of throwing — but never seed from a glitch sample, or every discard
      // would serve the poisoned reading for up to MAX_STALE_MS.
      const seed = toEnergyDataFromDetail(detail, flow);
      if (isImpossibleExport(seed)) {
        this.logGlitch(seed, flow);
      } else {
        this.remember(seed);
      }
      this.logger.info(
        `SEMS raw flow — grid=${flow.grid} gridStatus=${flow.gridStatus} ` +
          `loadStatus=${flow.loadStatus} pv=${flow.pv} load=${flow.load}`,
      );
    }
  }

  private trackGridDirection(flow: SemsPowerflow): void {
    const status = Number(flow.loadStatus);
    const gridMagnitude = parseSemsValue(flow.grid);
    const unknown = gridMagnitude !== null && gridMagnitude !== 0 &&
      (!Number.isFinite(status) || status === 0);
    if (unknown && !this.gridDirectionUnknown) {
      const message =
        `SEMS payload carries grid=${flow.grid} but no usable loadStatus (${flow.loadStatus}) — grid direction unknown, reporting 0W`;
      this.logger.warn(message);
      this.dbLog.warn(message, { payload: { powerflow: flow } });
    } else if (!unknown && this.gridDirectionUnknown) {
      this.logger.info(
        "SEMS loadStatus usable again — grid direction restored",
      );
    }
    this.gridDirectionUnknown = unknown;
  }

  // Backoff deliberately survives disconnect: lifecycle churn must not erase
  // a rate-limit window SEMS has declared.
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
      const detail = await this.guarded(() => {
        return this.client.getStationDetail(this.stationId);
      });
      if (!detail.powerflow) {
        this.logger.warn(
          `SEMS station ${this.stationId} responded without a power flow block (hasPowerflow=${detail.hasPowerflow})`,
        );
        throw new GoodweSemsConnectionError(
          "SEMS response carried no power flow block",
        );
      }
      const flow = detail.powerflow;
      void this.client.probeGatewayFlow?.(this.stationId, flow);
      const data = toEnergyDataFromDetail(detail, flow);
      this.trackGridDirection(flow);
      if (isImpossibleExport(data)) {
        this.logGlitch(data, flow);
        return this.lastGoodOrSanitized(data);
      }
      const remembered = this.remember(data);
      this.logger.info(
        `SEMS poll: solar=${remembered.solarProductionW}W grid=${remembered.gridPowerW}W home=${remembered.homeConsumptionW}W battery=${remembered.batteryPowerW}W soc=${remembered.batterySoc} (raw pv=${flow.pv} grid=${flow.grid} load=${flow.load} bettery=${flow.bettery} gridStatus=${flow.gridStatus})`,
      );
      return remembered;
    } catch (error) {
      if (error instanceof GoodweSemsRateLimitError) return this.serveCached();
      throw error;
    }
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const detail = await this.guarded(() => {
      return this.client.getStationDetail(this.stationId);
    });
    return {
      id: this.stationId,
      name: detail.stationName ?? "GoodWe SEMS",
      manufacturer: "GoodWe",
      model: detail.inverterModel ?? "SEMS Portal",
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
        this.logger.warn(
          `SEMS rate limited — pausing requests for ${
            Math.round(error.retryAfterMs / 1000)
          }s`,
        );
      }
      throw error;
    }
  }

  private logGlitch(data: EnergyData, flow: SemsPowerflow): void {
    const message = `SEMS glitch sample discarded — export ${-data
      .gridPowerW}W exceeds solar ${data.solarProductionW}W (raw pv=${flow.pv} grid=${flow.grid} load=${flow.load} bettery=${flow.bettery} gridStatus=${flow.gridStatus} loadStatus=${flow.loadStatus})`;
    this.logger.warn(message);
    this.dbLog.warn("SEMS glitch sample discarded", {
      payload: { powerflow: flow },
    });
  }

  // Fallback when a glitch sample must be discarded but no fresh cached
  // reading exists: serve the sample with grid forced to 0 — the corrupted
  // field is the grid figure, and phantom export must never start a charge.
  private lastGoodOrSanitized(parsed: EnergyData): EnergyData {
    if (this.lastGood && Date.now() - this.lastGoodAtMs <= MAX_STALE_MS) {
      return { ...this.lastGood };
    }
    return { ...parsed, gridPowerW: 0 };
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
        "SEMS is rate limiting and no recent reading is available",
      );
    }
    return { ...this.lastGood };
  }
}
