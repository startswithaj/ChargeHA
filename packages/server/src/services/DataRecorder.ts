import type { EnergyData } from "@chargeha/shared";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { TariffService } from "./TariffService.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { Logger } from "../lib/Logger.ts";
import { isHome as computeIsHome, parseHomeCoords } from "@chargeha/shared/geo";

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_DATA_RETENTION_DAYS = 730;
const DEFAULT_LOG_RETENTION_DAYS = 30;
const PRUNE_EVERY_N_TICKS = 100;

export class DataRecorder {
  private readonly db: AppDatabase;
  private readonly vehicleManager: VehicleManager;
  private readonly tariffService: TariffService;
  private readonly logger: Logger;
  /** Promise of the next pending setTimeout id. The async ctor-time
   *  scheduling means the id isn't known synchronously — wrapping it in
   *  a promise lets `stop()` always await the in-flight schedule and
   *  clear whatever id it lands on. */
  private timer: Promise<ReturnType<typeof setTimeout>> | null = null;
  private latestRealtime: EnergyData | null = null;
  private tickCount = 0;

  constructor(
    db: AppDatabase,
    vehicleManager: VehicleManager,
    tariffService: TariffService,
    eventEmitter: TypedEventEmitter,
    logger: Logger,
  ) {
    this.db = db;
    this.vehicleManager = vehicleManager;
    this.tariffService = tariffService;
    this.logger = logger;

    eventEmitter.subscribe("energy_update", (data) => {
      this.latestRealtime = data;
    });
    this.start();
  }

  private start(): void {
    this.logger.info("Started");
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    if (!this.timer) return;
    const id = await this.timer;
    clearTimeout(id);
    this.timer = null;
  }

  private scheduleNext(): void {
    // Read interval from DB config each tick (same pattern as ChargeController)
    this.timer = (async () => {
      try {
        const val = await this.db.getConfig("recording_interval_seconds");
        const seconds = parseInt(val ?? String(DEFAULT_INTERVAL_SECONDS), 10) ||
          DEFAULT_INTERVAL_SECONDS;
        return setTimeout(() => this.tick(), seconds * 1000);
      } catch (error) {
        this.logger.warn(
          "Failed to read recording_interval_seconds config:",
          error,
        );
        return setTimeout(
          () => this.tick(),
          DEFAULT_INTERVAL_SECONDS * 1000,
        );
      }
    })();
  }

  private async tick(): Promise<void> {
    await this.record();

    // Periodic pruning of old data
    this.tickCount++;
    if (this.tickCount % PRUNE_EVERY_N_TICKS === 0) {
      try {
        const dataVal = await this.db.getConfig("data_retention_days");
        const dataDays =
          parseInt(dataVal ?? String(DEFAULT_DATA_RETENTION_DAYS), 10) ||
          DEFAULT_DATA_RETENTION_DAYS;
        const logVal = await this.db.getConfig("log_retention_days");
        const logDays =
          parseInt(logVal ?? String(DEFAULT_LOG_RETENTION_DAYS), 10) ||
          DEFAULT_LOG_RETENTION_DAYS;
        await this.db.pruneEnergyReadings(dataDays);
        await this.db.pruneVehicleChargeReadings(dataDays);
        await this.db.pruneVehiclePollLogs(dataDays);
        // Plugin logs are noisy per-API-call entries — short retention.
        await this.db.prunePluginLogs(logDays);
      } catch (error) {
        this.logger.error("Failed to prune old data:", error);
      }
    }

    this.scheduleNext();
  }

  private async record(): Promise<void> {
    if (!this.latestRealtime) return;

    // Resolve tariff rate once per recording tick for both energy and vehicle readings
    const ratePerKwh = await this.tariffService.resolveCurrentRate();

    try {
      await this.db.insertEnergyReading(this.latestRealtime, ratePerKwh);
    } catch (error) {
      this.logger.error("Failed to write energy reading:", error);
    }

    try {
      await this.recordVehicleCharges(ratePerKwh);
    } catch (error) {
      this.logger.error(
        "Failed to write vehicle charge reading:",
        error,
      );
    }
  }

  private async recordVehicleCharges(
    ratePerKwh: number | null,
  ): Promise<void> {
    if (!this.latestRealtime) return;

    const allStates = await this.vehicleManager.getAllStates();
    if (allStates.size === 0) return;

    // Collect charging vehicles and their power
    const chargingVehicles = [...allStates]
      .filter(([_, state]) => state.isCharging && state.chargePowerKw > 0)
      .map(([id, state]) => ({ id, state }));
    const totalChargePowerW = chargingVehicles
      .reduce((sum, { state }) => sum + state.chargePowerKw * 1000, 0);

    if (chargingVehicles.length === 0) return;

    // Get energy data for solar attribution
    const energy = this.latestRealtime;
    const solarProductionW = energy.solarProductionW;
    const homeConsumptionW = energy.homeConsumptionW;
    // When the energy poll failed, the home/solar values are zeros (a breadcrumb
    // written by EnergyPoller) so we cannot compute solar attribution. Charge
    // everything to grid — that is the safe default during an inverter outage.
    const energyPollFailed = energy.pollFailed === true;

    const homeLat = await this.db.getConfig("home_latitude");
    const homeLng = await this.db.getConfig("home_longitude");
    const home = parseHomeCoords(homeLat, homeLng);

    await chargingVehicles.reduce((chain, { id, state }) => {
      const chargePowerW = state.chargePowerKw * 1000;
      const isHome = computeIsHome(home, state) ?? true; // Default to home if unknown

      // For away charging: solar_contribution_w = 0, grid_contribution_w = 0
      const homeAttribution = this.attributeHomeCharge(
        energyPollFailed,
        chargePowerW,
        totalChargePowerW,
        solarProductionW,
        homeConsumptionW,
      );
      const awayDefault = { solarContributionW: 0, gridContributionW: 0 };
      const { solarContributionW, gridContributionW } = isHome
        ? homeAttribution
        : awayDefault;
      // charge_power_w carries the total for away aggregation

      return chain.then(() =>
        this.db.insertVehicleChargeReading({
          vehicleId: id,
          chargePowerW,
          chargeAmps: state.chargeAmps,
          batteryLevel: state.batteryLevel,
          solarContributionW,
          gridContributionW,
          isHome,
          ratePerKwh,
        })
      );
    }, Promise.resolve());
  }

  /** Resolve the per-vehicle attribution at home, routing all charging to grid
   *  when the latest energy poll failed (we cannot trust solar/home values). */
  private attributeHomeCharge(
    energyPollFailed: boolean,
    chargePowerW: number,
    totalChargePowerW: number,
    solarProductionW: number,
    homeConsumptionW: number,
  ): { solarContributionW: number; gridContributionW: number } {
    if (energyPollFailed) {
      return { solarContributionW: 0, gridContributionW: chargePowerW };
    }
    return this.calculateSolarAttribution(
      chargePowerW,
      totalChargePowerW,
      solarProductionW,
      homeConsumptionW,
    );
  }

  /** Solar attribution: correct for the fact that the meter already
   *  includes EV draw in homeConsumption. */
  private calculateSolarAttribution(
    chargePowerW: number,
    totalChargePowerW: number,
    solarProductionW: number,
    homeConsumptionW: number,
  ): { solarContributionW: number; gridContributionW: number } {
    const availableSolar = Math.max(
      0,
      solarProductionW - homeConsumptionW + chargePowerW,
    );
    // Proportional split for multi-vehicle charging
    const vehicleShare = totalChargePowerW > 0
      ? chargePowerW / totalChargePowerW
      : 1;
    // Cap by actual solar production: when the home meter under-reports the
    // car's draw (e.g. a stuck/stale inverter), `availableSolar` can spike
    // beyond what the panels actually produced. Solar→car can never exceed
    // `solarProduction * vehicleShare` because that is the upper bound of
    // generation available to this vehicle.
    const solarContributionW = Math.min(
      chargePowerW,
      availableSolar * vehicleShare,
      Math.max(0, solarProductionW) * vehicleShare,
    );
    return {
      solarContributionW,
      gridContributionW: chargePowerW - solarContributionW,
    };
  }
}
