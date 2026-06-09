import type {
  CumulativeEnergyData,
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { EnergyReading, SolarConfig } from "@chargeha/shared/simulation";
import { generateSolarDay } from "@chargeha/shared/simulation";
import type { Logger } from "@chargeha/server/lib/Logger";

const GRID_VOLTAGE_V = 230;

/** Solar knobs matching the Simulator page. `seed` is the base seed. */
export type SimulatedEnergyOptions = SolarConfig;

/**
 * Produces a realistic solar/home/grid curve from the shared solar simulator.
 * The day's curve is regenerated when the local date rolls over, with the
 * configured seed offset by the date so each day differs but is deterministic.
 * EV charging load is overlaid separately by EnergyAdapterManager.
 */
export class SimulatedEnergyAdapter implements EnergySourceAdapter {
  private options: SimulatedEnergyOptions;
  private logger: Logger;

  // Solar curve cache, regenerated when the local day changes.
  private curve: EnergyReading[] = [];
  private curveDayKey = "";

  // Lifetime + daily accumulators, advanced by wall-clock delta on each read.
  private lifetimeSolarWh = 0;
  private lifetimeGridImportWh = 0;
  private lifetimeGridExportWh = 0;
  private dailySolarWh = 0;
  private accumDayKey = "";
  private lastAccumTime: number;
  private now: () => Date;

  constructor(
    options: SimulatedEnergyOptions,
    logger: Logger,
    now: () => Date = () => new Date(),
  ) {
    this.options = options;
    this.logger = logger;
    this.now = now;
    this.lastAccumTime = now().getTime();
  }

  pollIntervalSeconds(): number {
    return 10;
  }

  connect(): Promise<void> {
    this.logger.info(
      `Simulated inverter online — peak ${this.options.peakKw}kW, ` +
        `cloudiness ${this.options.cloudiness}%`,
    );
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  getRealtimeData(): Promise<EnergyData> {
    const reading = this.currentReading(this.now());
    return Promise.resolve({
      solarProductionW: reading.solarW,
      gridPowerW: reading.gridW,
      homeConsumptionW: reading.homeW,
      batteryPowerW: null,
      batterySoc: null,
      gridVoltageV: GRID_VOLTAGE_V,
      lastUpdated: new Date().toISOString(),
    });
  }

  getCumulativeData(): Promise<CumulativeEnergyData> {
    this.accumulate(this.now());
    return Promise.resolve({
      solarProducedWh: Math.round(this.lifetimeSolarWh),
      gridImportedWh: Math.round(this.lifetimeGridImportWh),
      gridExportedWh: Math.round(this.lifetimeGridExportWh),
      dailySolarProducedWh: Math.round(this.dailySolarWh),
      dailyGridImportWh: 0, // Overridden by EnergyPoller from DB
      dailyGridExportWh: 0, // Overridden by EnergyPoller from DB
    });
  }

  getDeviceInfo(): Promise<DeviceInfo> {
    return Promise.resolve({
      id: "simulated-energy",
      name: "Simulated Inverter",
      manufacturer: "ChargeHA",
      model: "Simulator",
    });
  }

  // --- Private helpers ---

  /** Stable per-local-day key, e.g. "2026-6-3". */
  private dayKey(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  /** Per-day seed offset so each local day produces a distinct curve. */
  private dayOffset(d: Date): number {
    return (d.getFullYear() * 1000) + (d.getMonth() + 1) * 31 + d.getDate();
  }

  private minuteOfDay(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
  }

  /** Regenerate the solar curve if the local day changed. */
  private ensureCurve(now: Date): void {
    const key = this.dayKey(now);
    if (key === this.curveDayKey && this.curve.length > 0) return;
    this.curve = generateSolarDay({
      ...this.options,
      seed: this.options.seed + this.dayOffset(now),
    });
    this.curveDayKey = key;
  }

  private currentReading(now: Date): EnergyReading {
    this.ensureCurve(now);
    return this.curve[this.minuteOfDay(now)];
  }

  /** Advance lifetime/daily energy counters by wall-clock delta. */
  private accumulate(now: Date): void {
    const reading = this.currentReading(now);
    const nowMs = now.getTime();
    const elapsedHours = (nowMs - this.lastAccumTime) / (1000 * 60 * 60);
    this.lastAccumTime = nowMs;

    const key = this.dayKey(now);
    if (key !== this.accumDayKey) {
      this.dailySolarWh = 0;
      this.accumDayKey = key;
    }
    if (elapsedHours <= 0) return;

    this.lifetimeSolarWh += reading.solarW * elapsedHours;
    this.dailySolarWh += reading.solarW * elapsedHours;
    if (reading.gridW > 0) {
      this.lifetimeGridImportWh += reading.gridW * elapsedHours;
    } else {
      this.lifetimeGridExportWh += -reading.gridW * elapsedHours;
    }
  }
}
