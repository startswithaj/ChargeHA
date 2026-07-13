import type { EnergyData, VehicleChargeState } from "../types.ts";
import type { ControllerConfig, EngineVehicleInput } from "./types.ts";

/** Eligible vehicle enriched with resolved electrical parameters. */
export interface AllocationEntry {
  id: string;
  name: string;
  priority: number;
  state: VehicleChargeState;
  voltage: number;
  phases: number;
}

interface AllocationContext {
  eligible: AllocationEntry[];
  totalAmps: number;
  availableW: number;
}

/** Solar calculation and multi-vehicle amp allocation. */
export class SolarAllocator {
  /** Resolve charger voltage: trust the vehicle if >= 100V, otherwise fall
   *  back to the inverter grid reading, then the user's configured value. */
  static resolveVoltage(
    state: VehicleChargeState,
    energy: EnergyData | null,
    config: ControllerConfig,
  ): number {
    if (state.chargerVoltage >= 100) return state.chargerVoltage;
    return energy?.gridVoltageV ?? config.gridVoltage;
  }

  /** Resolve charger phases: a live single-phase reading while charging
   *  overrides the threePhaseCharger flag (e.g. a three-phase install
   *  charging from a regular wall socket). Vehicles only report phases while
   *  charging, so the flag stands until a real reading arrives. */
  static resolvePhases(
    state: VehicleChargeState,
    config: ControllerConfig,
  ): number {
    if (state.isCharging && state.chargerPhases === 1) return 1;
    return config.threePhaseCharger ? 3 : state.chargerPhases;
  }

  /** Calculate available solar power in watts for a single vehicle's charging.
   *
   *  When the meter includes EV load in consumption (the default), we add back
   *  the vehicle's charge power to get true available solar. We use
   *  state.chargeAmps (kept current by VehicleManager.startChargingAt after
   *  confirmed commands) rather than the vehicle-reported chargePowerKw which
   *  can lag. */
  static calculateAvailableSolar(
    config: ControllerConfig,
    energy: EnergyData,
    state: VehicleChargeState,
    voltage: number,
    phases: number,
  ): number {
    // Gross mode: use total solar production. Excess mode: solar being exported.
    const baseW = config.solarReference === "gross"
      ? energy.solarProductionW
      : -energy.gridPowerW;
    const marginW = config.solarMarginKw * 1000;

    // When consumption_excludes_charging is ON, the meter doesn't see the EV
    // so the grid export already reflects true available — no adjustment needed.
    if (config.consumptionExcludesCharging || !state.isCharging) {
      return Math.max(0, baseW - marginW);
    }

    // When the meter INCLUDES EV charging in consumption (the default/common
    // case), the grid export is suppressed by the car's own load. Add back the
    // current charging power to get the true available solar.
    const currentChargingW = state.chargeAmps * voltage * phases;
    return Math.max(0, baseW + currentChargingW - marginW);
  }

  /** Top-level allocation dispatcher: waterfall or equal based on config. */
  static allocate(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): Map<string, number> {
    return config.priorityChargingEnabled
      ? SolarAllocator.waterfall(vehicles, config, energy)
      : SolarAllocator.equal(vehicles, config, energy);
  }

  /** Equal allocation: split amps evenly, remainder to highest priority.
   *  When the split gives any vehicle less than its chargeAmpsMin, progressively
   *  drops lowest-priority vehicles until the split is viable. */
  static equal(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): Map<string, number> {
    const ctx = SolarAllocator.getContext(vehicles, config, energy);
    if (!ctx) return new Map();
    const { eligible, totalAmps } = ctx;

    // Find the largest group of highest-priority vehicles where the
    // per-vehicle split meets every vehicle's chargeAmpsMin.
    // Hysteresis: vehicles already charging only need chargeAmpsMin to stay,
    // but new vehicles need chargeAmpsMin + 2A headroom to be included.
    // This prevents oscillation at the split boundary.
    const groupSizes = Array.from(
      { length: eligible.length },
      (_, i) => eligible.length - i,
    );
    const canSplit = (n: number) => {
      const perV = Math.floor(totalAmps / n);
      return eligible.slice(0, n).every((e) => {
        const buffer = e.state.isCharging ? 0 : 2;
        return perV >= e.state.chargeAmpsMin + buffer;
      });
    };
    const groupSize = groupSizes.find(canSplit) ?? 1;

    const recipients = eligible.slice(0, groupSize);
    const excluded = eligible.slice(groupSize);

    // Equal split with remainder: e.g. 11A across 2 vehicles = 6A + 5A.
    // Remainder amps go to higher-priority vehicles (lower index).
    const perVehicle = Math.floor(totalAmps / recipients.length);
    const remainder = totalAmps - perVehicle * recipients.length;

    const allocated = new Map([
      ...recipients.map((e, i) =>
        [e.id, perVehicle + (i < remainder ? 1 : 0)] as const
      ),
      ...excluded.map((e) => [e.id, 0] as const),
    ]);

    return allocated;
  }

  /** Waterfall allocation: priority 1 gets min(totalAmps, chargeAmpsMax),
   *  overflow goes to priority 2, then priority 3, etc. */
  static waterfall(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): Map<string, number> {
    const ctx = SolarAllocator.getContext(vehicles, config, energy);
    if (!ctx) return new Map();
    const { eligible, totalAmps } = ctx;

    // Each vehicle gets min(remaining, chargeAmpsMax) in priority order.
    const { allocations } = eligible.reduce(
      (acc, e) => {
        const amps = Math.min(acc.remaining, e.state.chargeAmpsMax);
        return {
          remaining: acc.remaining - amps,
          allocations: new Map(acc.allocations).set(e.id, amps),
        };
      },
      { remaining: totalAmps, allocations: new Map<string, number>() },
    );

    return allocations;
  }

  /** Build the allocation context: filter eligible vehicles, compute total
   *  available amps. Returns null when allocation doesn't apply (< 2 eligible
   *  vehicles, no energy data, or solar tracking disabled). */
  private static getContext(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): AllocationContext | null {
    if (!energy || !config.solarTrackingEnabled || vehicles.length < 2) {
      return null;
    }

    // Filter to eligible: auto mode, plugged in, at home (or unknown),
    // battery below charge limit.
    const eligible = vehicles
      .filter((v): v is EngineVehicleInput & { state: VehicleChargeState } =>
        v.mode === "auto" &&
        v.state?.isPluggedIn === true &&
        v.state.isHome !== false &&
        v.state.batteryLevel < v.state.chargeLimit
      )
      .map((v) => {
        const state = v.state;
        const voltage = SolarAllocator.resolveVoltage(state, energy, config);
        const phases = SolarAllocator.resolvePhases(state, config);
        return {
          id: v.id,
          name: v.name,
          priority: v.priority,
          state,
          voltage,
          phases,
        };
      })
      .sort((a, b) => a.priority - b.priority);

    if (eligible.length < 2) return null;

    // Base available watts: total solar (gross) or grid export (excess mode)
    const baseW = config.solarReference === "gross"
      ? energy.solarProductionW
      : -energy.gridPowerW;

    // When the meter includes EV load in consumption (default), grid export
    // is suppressed by charging vehicles' draw. Add back ALL charging
    // vehicles' power to recover the true available solar.
    const chargingAddBackW = config.consumptionExcludesCharging ? 0 : eligible
      .filter((e) => e.state.isCharging)
      .reduce((sum, e) => sum + e.state.chargeAmps * e.voltage * e.phases, 0);

    const availableW = Math.max(
      0,
      baseW + chargingAddBackW - config.solarMarginKw * 1000,
    );

    const { voltage: refV, phases: refP } = eligible[0];
    const totalAmps = Math.floor(availableW / (refV * refP));

    return { eligible, totalAmps, availableW };
  }
}
