import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import {
  GoodweSemsClient,
  GoodweSemsConnectionError,
  GoodweSemsRateLimitError,
  type GoodweSemsStationReader,
  type SemsPowerflow,
} from "./GoodweSemsClient.ts";

const POLL_INTERVAL_SECONDS = 60;

/** How long a cached reading may be served while SEMS is rate limiting us.
 *  Past this the adapter throws instead, so EnergyPoller records the outage
 *  rather than the dashboard showing stale numbers as current. */
const MAX_STALE_MS = 15 * 60 * 1000;

/** `loadStatus` value that means power is flowing in from the grid. The
 *  opposite value (-1) means exporting. See toGridPowerW. */
const LOAD_STATUS_IMPORTING = 1;

/** Strip the unit suffix SEMS appends to power values ("1234(W)") and parse.
 *  Returns null for absent, blank or unparseable fields — a non-battery
 *  inverter simply omits the battery keys. Accepts numbers because SEMS is
 *  inconsistent about quoting. */
export function parseSemsValue(
  raw: string | number | undefined,
): number | null {
  if (raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const stripped = raw.replace(/\([^)]*\)/g, "").trim();
  if (stripped === "") return null;
  const value = Number(stripped);
  return Number.isFinite(value) ? value : null;
}

/** Apply the SEMS status multiplier to a magnitude. */
export function applyStatus(
  magnitude: number,
  status: number | string | undefined,
): number {
  const multiplier = Number(status);
  if (!Number.isFinite(multiplier)) return magnitude;
  return magnitude * multiplier;
}

/** Convert the SEMS grid reading to ChargeHA's convention (positive = import).
 *
 *  SEMS sends `grid` as an UNSIGNED magnitude — it is positive whether the
 *  house is importing or exporting. The direction lives in `loadStatus`
 *  (1 = importing, -1 = exporting), confirmed against four real captured
 *  payloads covering both directions.
 *
 *  `gridStatus` looks like the obvious candidate and agrees on three of those
 *  four, but is -1 in both directions on a multi-inverter station, so it is
 *  not safe to sign by. Getting this wrong is not a cosmetic error: an
 *  exporting system would report as importing, and solar excess would never
 *  trigger a charge. */
export function toGridPowerW(flow: SemsPowerflow): number {
  const magnitude = parseSemsValue(flow.grid);
  if (magnitude === null) return 0;
  const direction = Number(flow.loadStatus) === LOAD_STATUS_IMPORTING ? 1 : -1;
  return Math.abs(magnitude) * direction;
}

/** Battery power, signed by its own status multiplier. SEMS spells the keys
 *  "bettery" / "betteryStatus". Null on inverters without a battery. */
export function toBatteryPowerW(flow: SemsPowerflow): number | null {
  const magnitude = parseSemsValue(flow.bettery);
  if (magnitude === null) return null;
  return applyStatus(Math.abs(magnitude), flow.betteryStatus);
}

export function toEnergyData(flow: SemsPowerflow): EnergyData {
  const load = parseSemsValue(flow.load);
  return {
    solarProductionW: parseSemsValue(flow.pv) ?? 0,
    gridPowerW: toGridPowerW(flow),
    // Load is reported as a magnitude with its own status sign; consumption is
    // never negative in EnergyData.
    homeConsumptionW: load === null ? 0 : Math.abs(load),
    batteryPowerW: toBatteryPowerW(flow),
    batterySoc: parseSemsValue(flow.soc),
    gridVoltageV: null,
    lastUpdated: new Date().toISOString(),
  };
}

export class GoodweSemsAdapter implements EnergySourceAdapter {
  private lastGood: EnergyData | null = null;
  private lastGoodAtMs = 0;
  /** Epoch ms before which no request may be issued. Set on a rate limit. */
  private backoffUntilMs = 0;

  /** Takes an assembled client rather than credentials — everything is known
   *  at construction time and tests inject a fake without an optional param. */
  constructor(
    private readonly client: GoodweSemsStationReader,
    private readonly stationId: string,
    private readonly logger: Logger,
  ) {}

  static create(
    account: string,
    password: string,
    stationId: string,
    logger: Logger,
  ): GoodweSemsAdapter {
    return new GoodweSemsAdapter(
      new GoodweSemsClient(account, password, logger),
      stationId,
      logger,
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
      // Seed the cache from the connect read so a rate limit on the very first
      // poll serves data instead of throwing.
      this.remember(toEnergyData(flow));
      // The grid sign convention is unresolved (see toGridPowerW). Logged once
      // per connect at info so the first real station answers it.
      this.logger.info(
        `SEMS raw flow — grid=${flow.grid} gridStatus=${flow.gridStatus} ` +
          `loadStatus=${flow.loadStatus} pv=${flow.pv} load=${flow.load}`,
      );
    }
  }

  disconnect(): Promise<void> {
    this.client.clearSession();
    this.lastGood = null;
    this.lastGoodAtMs = 0;
    this.backoffUntilMs = 0;
    return Promise.resolve();
  }

  async getRealtimeData(): Promise<EnergyData> {
    // Already backing off — serve cache without touching the network. Calling
    // during the window is what escalates a throttle into a block.
    if (this.isBackingOff()) return this.serveCached();

    try {
      const detail = await this.guarded(() => {
        return this.client.getStationDetail(this.stationId);
      });
      if (!detail.powerflow) {
        throw new GoodweSemsConnectionError(
          "SEMS response carried no power flow block",
        );
      }
      return this.remember(toEnergyData(detail.powerflow));
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

  private isBackingOff(): boolean {
    return Date.now() < this.backoffUntilMs;
  }

  /** Every outbound call goes through here: refuses to issue a request during
   *  a backoff window, and records the window when SEMS declares one. This is
   *  what keeps the rate-limit policy contained in the adapter. */
  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    if (this.isBackingOff()) {
      throw new GoodweSemsRateLimitError(this.backoffUntilMs - Date.now());
    }
    try {
      return await call();
    } catch (error) {
      if (error instanceof GoodweSemsRateLimitError) {
        this.backoffUntilMs = Date.now() + error.retryAfterMs;
        this.logger.warn(
          `SEMS rate limited — pausing requests for ${
            Math.round(error.retryAfterMs / 1000)
          }s`,
        );
      }
      throw error;
    }
  }

  private remember(data: EnergyData): EnergyData {
    this.lastGood = data;
    this.lastGoodAtMs = Date.now();
    return data;
  }

  /** Last good reading, restamped, while it is still within the staleness
   *  budget. Beyond that the outage is real and must surface. */
  private serveCached(): EnergyData {
    const age = Date.now() - this.lastGoodAtMs;
    if (!this.lastGood || age > MAX_STALE_MS) {
      throw new GoodweSemsConnectionError(
        "SEMS is rate limiting and no recent reading is available",
      );
    }
    return { ...this.lastGood, lastUpdated: new Date().toISOString() };
  }
}
