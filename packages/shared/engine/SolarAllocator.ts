import type { EnergyData, VehicleChargeState } from "../types.ts";
import type { ControllerConfig, EngineVehicleInput } from "./types.ts";

// Eligible vehicle enriched with resolved electrical parameters.
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

export class SolarAllocator {
  // Resolve charger voltage: trust the reading if present and >= 100V,
  // otherwise fall back to the inverter grid reading, then the user's configured value.
  static resolveVoltage(
    chargerVoltage: number | null,
    energy: EnergyData | null,
    gridVoltage: number,
  ): number {
    if (chargerVoltage !== null && chargerVoltage >= 100) return chargerVoltage;
    return energy?.gridVoltageV ?? gridVoltage;
  }

  // A live single-phase reading while charging overrides the threePhaseCharger
  // flag (e.g. a three-phase install on a regular wall socket); vehicles only report phases while charging, so the flag stands until a real reading arrives.
  static resolvePhases(
    state: VehicleChargeState,
    config: ControllerConfig,
  ): number {
    if (state.isCharging && state.chargerPhases === 1) return 1;
    return config.threePhaseCharger ? 3 : state.chargerPhases;
  }

  // Surplus solar in watts, before the safety margin.
  //
  // Starts from grid export, then:
  // - Subtracts home battery discharge. Power leaving the battery is not
  //   solar. Without this, a battery operating in self-consumption won't be
  //   drawing from the grid, and would makes the EV's own draw reappear as
  //   "available solar" through the add-back below, and the car would charge
  //   off the home battery.
  // - Adds back the EV's charge power when the meter includes EV load in
  //   consumption (the default), since the car's own draw suppresses export.
  // - Caps at solar production: surplus can never exceed what the panels are
  //   making right now.
  //
  // `addBackW` is the charge power to add back — 0 when the meter excludes EV
  // load or nothing is charging.
  static surplusW(
    energy: EnergyData,
    addBackW: number,
  ): number {
    const batteryDischargeW = Math.max(0, energy.batteryPowerW ?? 0);
    const exportW = -energy.gridPowerW - batteryDischargeW;
    return Math.min(exportW + addBackW, energy.solarProductionW);
  }

  // Charge power to add back for one vehicle — zero when the meter already
  // excludes EV load, or the vehicle isn't drawing anything. Uses
  // state.chargeAmps (kept current by VehicleManager after confirmed commands), not the vehicle-reported chargePowerKw, which can lag.
  static addBackW(
    config: ControllerConfig,
    state: VehicleChargeState,
    voltage: number,
    phases: number,
  ): number {
    if (config.consumptionExcludesCharging || !state.isCharging) return 0;
    return state.chargeAmps * voltage * phases;
  }

  // Available watts after the reference mode and safety margin are applied.
  // `addBackW` is the total charge power to add back across all vehicles being considered.
  static resolveAvailableW(
    config: ControllerConfig,
    energy: EnergyData,
    addBackW: number,
  ): number {
    const marginW = config.solarMarginKw * 1000;

    // Gross mode: total panel output, as-is. No add-back — panel output never
    // had the car's draw subtracted from it, so adding it would double-count.
    if (config.solarReference === "gross") {
      return Math.max(0, energy.solarProductionW - marginW);
    }

    return Math.max(0, SolarAllocator.surplusW(energy, addBackW) - marginW);
  }

  static calculateAvailableSolar(
    config: ControllerConfig,
    energy: EnergyData,
    state: VehicleChargeState,
    voltage: number,
    phases: number,
  ): number {
    return SolarAllocator.resolveAvailableW(
      config,
      energy,
      SolarAllocator.addBackW(config, state, voltage, phases),
    );
  }

  static allocate(
    vehicles: EngineVehicleInput[],
    config: ControllerConfig,
    energy: EnergyData | null,
  ): Map<string, number> {
    return config.priorityChargingEnabled
      ? SolarAllocator.waterfall(vehicles, config, energy)
      : SolarAllocator.equal(vehicles, config, energy);
  }

  // Equal allocation: split amps evenly, remainder to highest priority.
  // When the split gives any vehicle less than its chargeAmpsMin, progressively drops lowest-priority vehicles until the split is viable.
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

  // Waterfall allocation: priority 1 gets min(totalAmps, chargeAmpsMax),
  // overflow goes to priority 2, then priority 3, etc.
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

  // Filter eligible vehicles, compute total available amps. Returns null
  // when allocation doesn't apply (< 2 eligible vehicles, no energy data, or solar tracking disabled).
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
        const voltage = SolarAllocator.resolveVoltage(
          state.chargerVoltage,
          energy,
          config.gridVoltage,
        );
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

    // Add back ALL charging vehicles' power — in excess mode the grid export
    // is suppressed by every car's draw, not just one.
    const chargingAddBackW = eligible.reduce(
      (sum, e) =>
        sum + SolarAllocator.addBackW(config, e.state, e.voltage, e.phases),
      0,
    );

    const availableW = SolarAllocator.resolveAvailableW(
      config,
      energy,
      chargingAddBackW,
    );

    const { voltage: refV, phases: refP } = eligible[0];
    const totalAmps = Math.floor(availableW / (refV * refP));

    return { eligible, totalAmps, availableW };
  }
}
