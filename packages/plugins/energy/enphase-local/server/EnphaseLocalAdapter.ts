import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { EnphaseClient } from "./EnphaseClient.ts";

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
const INFO_PATH = "/info";

type MeterConfig = { eid: number; measurementType: string };
type MeterReading = { eid: number; activePower: number };

/** eid → measurementType map from `/ivp/meters`, or null when no CT meters. */
type MeterMap = { production: number; netConsumption: number } | null;

function meterMapFrom(meters: MeterConfig[]): MeterMap {
  const production = meters.find((m) => m.measurementType === "production");
  const net = meters.find((m) => m.measurementType === "net-consumption");
  return production && net
    ? { production: production.eid, netConsumption: net.eid }
    : null;
}

/** Extract the first XML tag value, e.g. tagValue(xml, "sn"). */
function tagValue(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? "";
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

  constructor(
    private readonly client: EnphaseClient,
    private readonly logger: Logger,
  ) {}

  pollIntervalSeconds(): number {
    return 10;
  }

  async connect(): Promise<void> {
    // Probing the meter config both verifies auth/reachability and caches the
    // eid map used by every subsequent poll.
    await this.resolveMeterMap();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  async getRealtimeData(): Promise<EnergyData> {
    const { solarProductionW, gridPowerW } = await this.readPower();
    const batteryPowerW = await this.readBatteryPowerW();
    const batterySoc = await this.readBatterySoc();

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
      this.logger.info(
        "Envoy has no production + net-consumption CT meters — falling back to solar-only readings",
      );
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

  /** Optional read — ensemble endpoints 404 on battery-less systems; a
   *  failure here never fails the whole poll. */
  private async tryGetJson(path: string): Promise<unknown> {
    try {
      return await this.client.getJson(path);
    } catch (err) {
      this.logger.warn(`Envoy optional read ${path} failed: ${err}`);
      return null;
    }
  }
}
