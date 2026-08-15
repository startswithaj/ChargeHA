import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import {
  GoodweSemsClient,
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
  type GoodweSemsStationReader,
  type SemsPowerflow,
} from "./GoodweSemsClient.ts";

const POLL_INTERVAL_SECONDS = 60;

const MAX_STALE_MS = 15 * 60 * 1000;

const LOAD_STATUS_IMPORTING = 1;

// Backoff windows outlive adapter instances: a config save rebuilds the
// adapter, and a fresh instance must not call SEMS inside a declared window.
const backoffUntilByStation = new Map<string, number>();

export function resetSemsBackoffForTests(): void {
  backoffUntilByStation.clear();
}

const UNIT_SCALES: Record<string, number> = { w: 1, kw: 1000, mw: 1_000_000 };

export function parseSemsValue(
  raw: string | number | undefined,
): number | null {
  if (raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  // The parenthesised suffix is a unit, not decoration — "3.5(kW)" is 3500W.
  const unit = /\(([^)]*)\)/.exec(raw)?.[1].trim().toLowerCase();
  const stripped = raw.replace(/\([^)]*\)/g, "").trim();
  if (stripped === "") return null;
  const value = Number(stripped);
  if (!Number.isFinite(value)) return null;
  return value * (UNIT_SCALES[unit ?? ""] ?? 1);
}

export function applyStatus(
  magnitude: number,
  status: number | string | undefined,
): number {
  const multiplier = Number(status);
  if (!Number.isFinite(multiplier)) return magnitude;
  return magnitude * multiplier;
}

// SEMS sends `grid` unsigned in both directions; `loadStatus` carries the
// direction. `gridStatus` is -1 in both directions on multi-inverter stations,
// so it is not safe to sign by.
export function toGridPowerW(flow: SemsPowerflow): number {
  const magnitude = parseSemsValue(flow.grid);
  if (magnitude === null) return 0;
  const status = Number(flow.loadStatus);
  // Unknown direction must not read as export: phantom export starts a charge
  // that draws real grid power.
  if (!Number.isFinite(status) || status === 0) return 0;
  const direction = status === LOAD_STATUS_IMPORTING ? 1 : -1;
  return Math.abs(magnitude) * direction;
}

export function toBatteryPowerW(flow: SemsPowerflow): number | null {
  const magnitude = parseSemsValue(flow.bettery);
  if (magnitude === null) return null;
  return applyStatus(Math.abs(magnitude), flow.betteryStatus);
}

const EXPORT_TOLERANCE_W = 40;

// SEMS sometimes reports a grid export that exceeds the solar production
// // plus battery output. The export is signed by `loadStatus` but the solar and
//   10:27:57  solar=3218W  grid=-3827W  home=0W  (raw load=0(W) gridStatus=1)   ← exporting 609W more than solar
//   10:47:57  solar=2551W  grid=-3997W  home=0W  (raw load=0(W) gridStatus=1)   ← 1446W over
//   10:49–51  solar=3911W  grid=-6392…-6440W  home=0W                            ← 2.5kW over, 3-poll window
//   10:58:56  solar=2680W  grid=-6176W  home=0W                                  ← 3.5kW over — the worst
//   11:00:03  solar=4954W  grid=-7252W  home=0W
//   11:14:58  solar=4835W  grid=-5335W  home=0W
export function isImpossibleExport(data: EnergyData): boolean {
  const exportW = -data.gridPowerW;
  if (exportW <= 0) return false;
  const batteryW = Math.abs(data.batteryPowerW ?? 0);
  return exportW > data.solarProductionW + batteryW + EXPORT_TOLERANCE_W;
}

export function toEnergyData(flow: SemsPowerflow): EnergyData {
  const load = parseSemsValue(flow.load);
  const solar = parseSemsValue(flow.pv) ?? 0;
  const grid = toGridPowerW(flow);
  return {
    solarProductionW: solar,
    gridPowerW: grid,
    // Overnight the inverter sleeps and SEMS sends load as an empty string
    // with only the meter reporting. Home consumption is still solar + signed
    // grid (the same balance SEMS uses to compute load), so derive it instead
    // of showing 0W.
    homeConsumptionW: load === null
      ? Math.max(0, solar + grid)
      : Math.abs(load),
    batteryPowerW: toBatteryPowerW(flow),
    batterySoc: parseSemsValue(flow.soc),
    gridVoltageV: null,
    lastUpdated: new Date().toISOString(),
  };
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
      const seed = toEnergyData(flow);
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
      const parsed = toEnergyData(detail.powerflow);
      this.trackGridDirection(detail.powerflow);
      void this.client.probeGatewayFlow?.(this.stationId, detail.powerflow);
      if (isImpossibleExport(parsed)) {
        this.logGlitch(parsed, detail.powerflow);
        return this.lastGoodOrSanitized(parsed);
      }
      const data = this.remember(parsed);
      this.logger.info(
        `SEMS poll: solar=${data.solarProductionW}W grid=${data.gridPowerW}W home=${data.homeConsumptionW}W battery=${data.batteryPowerW}W soc=${data.batterySoc} (raw pv=${detail.powerflow.pv} grid=${detail.powerflow.grid} load=${detail.powerflow.load} bettery=${detail.powerflow.bettery} gridStatus=${detail.powerflow.gridStatus})`,
      );
      return data;
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
