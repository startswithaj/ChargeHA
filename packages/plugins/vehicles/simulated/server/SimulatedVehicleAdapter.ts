import type {
  AdapterVehicleChargeState,
  CallContext,
  SimulationControls,
  VehicleAdapter,
} from "@chargeha/shared";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "../../../PluginDbLogger.ts";

export interface SimulatedVehicleConfig {
  batteryCapacityKwh?: number;
  maxChargeRateKw?: number;
  voltage?: number;
  phases?: number;
  minAmps?: number;
  maxAmps?: number;
  initialSocPercent?: number;
  chargeLimitPercent?: number;
  vehicleName?: string;
  homeLat?: number;
  homeLng?: number;
}

const DEFAULTS: Required<SimulatedVehicleConfig> = {
  batteryCapacityKwh: 75,
  maxChargeRateKw: 11,
  voltage: 230,
  phases: 1,
  minAmps: 5,
  maxAmps: 32,
  initialSocPercent: 50,
  chargeLimitPercent: 80,
  vehicleName: "Simulated EV",
  homeLat: -33.8688,
  homeLng: 151.2093,
};

export class SimulatedVehicleAdapter implements VehicleAdapter {
  private id: string;
  private config: Required<SimulatedVehicleConfig>;
  private logger: Logger;
  private dbLog: PluginDbLogger;

  // Internal state
  private socPercent: number;
  private chargeLimit: number;
  private isCharging = false;
  private isPluggedIn = true;
  private chargeAmps: number;
  private energyAddedKwh = 0;
  private lastUpdateTime: number = Date.now();

  // Home location (read from DB config, or defaults)
  private homeLat: number;
  private homeLng: number;

  // Callback for energy interceptor wiring
  onPowerChange?: (watts: number) => void;

  constructor(
    id: string,
    userConfig: SimulatedVehicleConfig = {},
    logger: Logger,
    dbLog: PluginDbLogger,
  ) {
    this.id = id;
    this.config = { ...DEFAULTS, ...userConfig };
    this.logger = logger;
    this.dbLog = dbLog;
    this.socPercent = this.config.initialSocPercent;
    this.chargeLimit = this.config.chargeLimitPercent;
    this.chargeAmps = this.config.minAmps;
    this.homeLat = userConfig.homeLat ?? -33.8688;
    this.homeLng = userConfig.homeLng ?? 151.2093;
  }

  connect(ctx: CallContext): Promise<void> {
    this.logger.info(
      `${this.config.vehicleName} (${this.id}) connected — SOC ${this.socPercent}%, limit ${this.chargeLimit}%`,
    );
    this.dbLog.info("connect", {
      payload: {
        vehicleId: this.id,
        socPercent: this.socPercent,
        chargeLimit: this.chargeLimit,
      },
      origin: ctx.origin,
      traceId: ctx.traceId,
    });
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    if (this.isCharging) {
      this.isCharging = false;
      this.onPowerChange?.(0);
    }
    return Promise.resolve();
  }

  getChargeState(ctx: CallContext): Promise<AdapterVehicleChargeState> {
    this.updateSoc();

    const powerKw = this.isCharging ? this.calculatePowerKw() : 0;

    // Estimate minutes to full
    const remainingKwh = this.config.batteryCapacityKwh *
      (this.chargeLimit - this.socPercent) / 100;
    const minutesToFull = (this.isCharging && powerKw > 0)
      ? Math.max(0, Math.round((remainingKwh / powerKw) * 60))
      : 0;

    const state = {
      vehicleId: this.id,
      batteryLevel: Math.round(this.socPercent * 10) / 10,
      chargeLimit: this.chargeLimit,
      isCharging: this.isCharging,
      isPluggedIn: this.isPluggedIn,
      isOnline: true,
      chargeAmps: this.isCharging ? this.chargeAmps : 0,
      chargeAmpsMax: this.config.maxAmps,
      chargeAmpsMin: this.config.minAmps,
      chargePowerKw: Math.round(powerKw * 100) / 100,
      chargerVoltage: this.config.voltage,
      chargerPhases: this.config.phases,
      energyAddedKwh: Math.round(this.energyAddedKwh * 100) / 100,
      minutesToFull,
      chargePortOpen: this.isPluggedIn,
      vehicleName: this.config.vehicleName,
      lastUpdated: new Date().toISOString(),
      latitude: this.homeLat,
      longitude: this.homeLng,
    };

    this.dbLog.debug("getChargeState", {
      payload: {
        vehicleId: this.id,
        batteryLevel: state.batteryLevel,
        isCharging: state.isCharging,
        chargeAmps: state.chargeAmps,
      },
      origin: ctx.origin,
      traceId: ctx.traceId,
    });

    return Promise.resolve(state);
  }

  startCharging(ctx: CallContext): Promise<boolean> {
    if (!this.isPluggedIn) return Promise.resolve(false);
    if (this.socPercent >= this.chargeLimit) return Promise.resolve(false);

    this.isCharging = true;
    this.lastUpdateTime = Date.now();
    const powerW = this.calculatePowerKw() * 1000;
    this.onPowerChange?.(powerW);
    this.logger.info(
      `${this.config.vehicleName} started charging at ${this.chargeAmps}A (${
        Math.round(powerW)
      }W)`,
    );
    this.dbLog.info("startCharging", {
      payload: {
        vehicleId: this.id,
        amps: this.chargeAmps,
        powerW: Math.round(powerW),
      },
      origin: ctx.origin,
      traceId: ctx.traceId,
    });
    return Promise.resolve(true);
  }

  stopCharging(ctx: CallContext): Promise<boolean> {
    if (this.isCharging) {
      this.updateSoc(); // Finalize SOC before stopping
    }
    this.isCharging = false;
    this.onPowerChange?.(0);
    this.logger.info(
      `${this.config.vehicleName} stopped charging at SOC ${
        this.socPercent.toFixed(1)
      }%`,
    );
    this.dbLog.info("stopCharging", {
      payload: {
        vehicleId: this.id,
        socPercent: Math.round(this.socPercent * 10) / 10,
      },
      origin: ctx.origin,
      traceId: ctx.traceId,
    });
    return Promise.resolve(true);
  }

  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    // Finalize SOC at old rate before changing
    if (this.isCharging) {
      this.updateSoc();
    }

    this.chargeAmps = Math.max(
      this.config.minAmps,
      Math.min(this.config.maxAmps, Math.round(amps)),
    );

    if (this.isCharging) {
      const powerW = this.calculatePowerKw() * 1000;
      this.onPowerChange?.(powerW);
      this.logger.debug(
        `${this.config.vehicleName} amps set to ${this.chargeAmps}A (${
          Math.round(powerW)
        }W)`,
      );
    }
    this.dbLog.info("setChargeAmps", {
      payload: { vehicleId: this.id, amps: this.chargeAmps },
      origin: ctx.origin,
      traceId: ctx.traceId,
    });
    return Promise.resolve(true);
  }

  async setChargeLimit(percent: number, ctx: CallContext): Promise<boolean> {
    this.chargeLimit = Math.max(0, Math.min(100, Math.round(percent)));
    this.logger.info(
      `${this.config.vehicleName} charge limit set to ${this.chargeLimit}%`,
    );
    this.dbLog.info("setChargeLimit", {
      payload: { vehicleId: this.id, chargeLimit: this.chargeLimit },
      origin: ctx.origin,
      traceId: ctx.traceId,
    });

    // Auto-stop if SOC already at or above new limit
    if (this.isCharging && this.socPercent >= this.chargeLimit) {
      await this.stopCharging(ctx);
    }
    return true;
  }

  wakeVehicle(ctx: CallContext): Promise<boolean> {
    this.dbLog.debug("wakeVehicle", {
      payload: { vehicleId: this.id },
      origin: ctx.origin,
      traceId: ctx.traceId,
    });
    return Promise.resolve(true); // Always online
  }

  isVehicleOnline(_ctx: CallContext): Promise<boolean> {
    return Promise.resolve(true);
  }

  setSocPercent(value: number): void {
    // Finalize any in-progress charging before overriding SOC
    this.updateSoc();

    this.socPercent = Math.max(0, Math.min(100, value));
    this.logger.info(
      `${this.config.vehicleName} SOC set to ${this.socPercent}%`,
    );

    // If SOC is now at or above charge limit, stop charging
    if (this.isCharging && this.socPercent >= this.chargeLimit) {
      this.isCharging = false;
      this.onPowerChange?.(0);
    }
  }

  setPluggedIn(value: boolean): void {
    this.isPluggedIn = value;
    if (!value && this.isCharging) {
      this.updateSoc();
      this.isCharging = false;
      this.onPowerChange?.(0);
    }
  }

  setLocation(lat: number, lng: number): void {
    this.homeLat = lat;
    this.homeLng = lng;
  }

  getSimulationControls(): SimulationControls {
    return {
      setSocPercent: (value: number) => this.setSocPercent(value),
      setPluggedIn: (value: boolean) => this.setPluggedIn(value),
      setLocation: (lat: number, lng: number) => this.setLocation(lat, lng),
    };
  }

  /** Get current charge power in watts (0 if not charging). */
  getCurrentPowerW(): number {
    return this.isCharging ? this.calculatePowerKw() * 1000 : 0;
  }

  // --- Private helpers ---

  private calculatePowerKw(): number {
    const powerKw = (this.chargeAmps * this.config.voltage *
      this.config.phases) / 1000;
    return Math.min(powerKw, this.config.maxChargeRateKw);
  }

  /** Advance battery SOC based on elapsed time and current charge power. */
  private updateSoc(): void {
    if (!this.isCharging) return;

    const now = Date.now();
    const elapsedHours = (now - this.lastUpdateTime) / (1000 * 60 * 60);
    this.lastUpdateTime = now;

    if (elapsedHours <= 0) return;

    const powerKw = this.calculatePowerKw();
    const energyKwh = powerKw * elapsedHours;
    const socIncrease = (energyKwh / this.config.batteryCapacityKwh) * 100;

    this.socPercent = Math.min(
      this.chargeLimit,
      this.socPercent + socIncrease,
    );
    this.energyAddedKwh += energyKwh;

    // Auto-stop when charge limit reached
    if (this.socPercent >= this.chargeLimit) {
      this.socPercent = this.chargeLimit;
      this.isCharging = false;
      this.onPowerChange?.(0);
      this.logger.info(
        `${this.config.vehicleName} reached charge limit ${this.chargeLimit}%`,
      );
    }
  }
}
