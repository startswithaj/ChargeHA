import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/plugins/PluginDbLogger";
import { EnphaseConnectionError } from "./EnphaseClient.ts";
import type { EnphaseClient } from "./EnphaseClient.ts";
import { INFO_PATH, tagValue } from "./envoyInfo.ts";

// ── Envoy local API endpoints (firmware 7+) ─────────────────────────────────
// Response shapes follow the community-documented local API as implemented by
// the Home Assistant `pyenphase` library:
// https://github.com/pyenphase/pyenphase
//
// `/ivp/meters` + `/ivp/meters/readings` need CT meters installed; systems
// without them fall back to `/api/v1/production` (solar watts only, no grid).

const METERS_PATH = "/ivp/meters";
const METER_READINGS_PATH = "/ivp/meters/readings";
const PRODUCTION_FALLBACK_PATH = "/api/v1/production";
const ENSEMBLE_POWER_PATH = "/ivp/ensemble/power";
const ENSEMBLE_SECCTRL_PATH = "/ivp/ensemble/secctrl";
// An identical poll error repeats every poll; persist one plugin-log entry
// per this window instead of one per poll (poll interval is configurable).
const POLL_ERROR_RELOG_MS = 5 * 60 * 1000;

type MeterConfig = { eid: number; state: string; measurementType: string };
type MeterReading = { eid: number; activePower: number };

/** eid → measurementType map from `/ivp/meters`, or null when no CT meters. */
type MeterMap = { production: number; netConsumption: number } | null;

function meterMapFrom(meters: MeterConfig[]): MeterMap {
  // A metered Envoy without CTs actually wired still lists the meters, with
  // state "disabled" — using those eids would read garbage as grid power.
  const enabled = meters.filter((m) => m.state === "enabled");
  const production = enabled.find((m) => m.measurementType === "production");
  const net = enabled.find((m) => m.measurementType === "net-consumption");
  return production && net
    ? { production: production.eid, netConsumption: net.eid }
    : null;
}

/**
 * Reads an Enphase Envoy / IQ Gateway over its local HTTPS API and maps the
 * responses to the ChargeHA `EnergySourceAdapter` contract.
 *
 * Sign conventions:
 *  - `gridPowerW`: the Envoy's `net-consumption` CT reports + import / − export
 *    — same as ChargeHA's convention, passes through.
 *  - `batteryPowerW`: ensemble `real_power_mw` is + discharge / − charge —
 *    same as ChargeHA's convention, passes through.
 *
 * Without CT meters only solar production is known: grid is reported as 0 and
 * home consumption as the solar value.
 */
export class EnphaseLocalAdapter implements EnergySourceAdapter {
  private meterMap: MeterMap = null;
  private metersProbed = false;
  private ensembleAbsent = false;
  private lastPollError = "";
  private lastPollErrorLoggedAt = 0;
  private pollErrorRepeats = 0;

  constructor(
    private readonly client: EnphaseClient,
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
    private readonly now: () => number = Date.now,
  ) {}

  pollIntervalSeconds(): number {
    return 10;
  }

  async connect(): Promise<void> {
    // Probing the meter config both verifies auth/reachability and caches the
    // eid map used by every subsequent poll.
    try {
      const map = await this.resolveMeterMap();
      const mode = map ? "CT meter readings" : "solar-only fallback";
      const message =
        `Connected to Envoy at ${this.client.host} — using ${mode}`;
      this.logger.info(message);
      await this.dbLog.info(message);
    } catch (err) {
      await this.recordPollError(err);
      throw err;
    }
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  async getRealtimeData(): Promise<EnergyData> {
    try {
      return await this.readRealtimeData();
    } catch (err) {
      await this.recordPollError(err);
      throw err;
    }
  }

  private async readRealtimeData(): Promise<EnergyData> {
    const [{ solarProductionW, gridPowerW }, batteryPowerW, batterySoc] =
      await Promise.all([
        this.readPower(),
        this.readBatteryPowerW(),
        this.readBatterySoc(),
      ]);
    this.lastPollError = "";
    this.pollErrorRepeats = 0;

    const homeConsumptionW = Math.max(
      0,
      solarProductionW + gridPowerW + (batteryPowerW ?? 0),
    );

    return {
      solarProductionW,
      gridPowerW,
      homeConsumptionW,
      batteryPowerW,
      batterySoc,
      gridVoltageV: null,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const xml = await this.client.getRaw(INFO_PATH);
    const serial = tagValue(xml, "sn");
    const model = tagValue(xml, "pn");
    return {
      id: serial || "unknown",
      name: "Enphase Envoy",
      manufacturer: "Enphase",
      model: model || "Unknown",
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async resolveMeterMap(): Promise<MeterMap> {
    if (this.metersProbed) return this.meterMap;
    const meters = await this.client.getJson(METERS_PATH) as MeterConfig[];
    this.meterMap = meterMapFrom(meters);
    this.metersProbed = true;
    if (!this.meterMap) {
      const message =
        "Envoy has no enabled production + net-consumption CT meters — falling back to solar-only readings (grid reported as 0)";
      this.logger.info(message);
      await this.dbLog.info(message);
    }
    return this.meterMap;
  }

  private async readPower(): Promise<
    { solarProductionW: number; gridPowerW: number }
  > {
    const map = await this.resolveMeterMap();
    if (!map) return this.readPowerFallback();

    const readings = await this.client.getJson(
      METER_READINGS_PATH,
    ) as MeterReading[];
    const powerFor = (eid: number) =>
      Math.round(readings.find((r) => r.eid === eid)?.activePower ?? 0);
    return {
      solarProductionW: powerFor(map.production),
      gridPowerW: powerFor(map.netConsumption),
    };
  }

  /** No CT meters: solar watts from the legacy endpoint, grid unknown. */
  private async readPowerFallback(): Promise<
    { solarProductionW: number; gridPowerW: number }
  > {
    const production = await this.client.getJson(
      PRODUCTION_FALLBACK_PATH,
    ) as { wattsNow?: number };
    return {
      solarProductionW: Math.round(production.wattsNow ?? 0),
      gridPowerW: 0,
    };
  }

  /** + discharge / − charge. Absent (no IQ Battery) → null. */
  private async readBatteryPowerW(): Promise<number | null> {
    const power = await this.tryGetJson(ENSEMBLE_POWER_PATH) as
      | { devices?: { real_power_mw: number }[] }
      | null;
    const devices = power?.devices;
    if (!devices || devices.length === 0) return null;
    return Math.round(
      devices.reduce((sum, d) => sum + d.real_power_mw, 0) / 1000,
    );
  }

  private async readBatterySoc(): Promise<number | null> {
    const secctrl = await this.tryGetJson(ENSEMBLE_SECCTRL_PATH) as
      | { agg_soc?: number }
      | null;
    return secctrl?.agg_soc ?? null;
  }

  /** Persist a poll failure to the plugin log. An unchanged error message is
   *  re-logged at most once per POLL_ERROR_RELOG_MS, not every poll. */
  private async recordPollError(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const repeated = message === this.lastPollError;
    this.pollErrorRepeats = repeated ? this.pollErrorRepeats + 1 : 0;
    this.lastPollError = message;
    const nowMs = this.now();
    if (repeated && nowMs - this.lastPollErrorLoggedAt < POLL_ERROR_RELOG_MS) {
      return;
    }
    this.lastPollErrorLoggedAt = nowMs;
    await this.dbLog.error(`Envoy poll failed: ${message}`, {
      payload: repeated ? { consecutiveFailures: this.pollErrorRepeats } : {},
    });
  }

  /** Optional read — ensemble endpoints 404 on battery-less systems; a
   *  failure here never fails the whole poll. A 404 marks the ensemble as
   *  absent so battery-less systems aren't re-probed (and re-logged) every
   *  poll. */
  private async tryGetJson(path: string): Promise<unknown> {
    if (this.ensembleAbsent) return null;
    try {
      return await this.client.getJson(path);
    } catch (err) {
      if (err instanceof EnphaseConnectionError && err.status === 404) {
        this.ensembleAbsent = true;
        const message =
          "Envoy has no battery (ensemble endpoints absent) — skipping battery readings";
        this.logger.info(message);
        await this.dbLog.info(message);
        return null;
      }
      this.logger.warn(`Envoy optional read ${path} failed: ${err}`);
      return null;
    }
  }
}
