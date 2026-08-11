import type { VehicleChargeState } from "../types.ts";
import { ControllerEngine } from "../engine/mod.ts";
import type { ControllerConfig, EngineVehicleInput } from "../engine/mod.ts";

import { generateSolarDay } from "./solar.ts";
import type {
  ControllerEvent,
  SimResult,
  SimulationOptions,
  SimulationOutput,
  VehicleConfig,
  VehicleResult,
} from "./types.ts";

const VOLTAGE = 230;

function buildControllerConfig(opts: SimulationOptions): ControllerConfig {
  return {
    chargingEnabled: true,
    controllerLoopSeconds: 60,
    solarTrackingEnabled: true,
    solarTrackingMode: "solar_only",
    solarReference: "excess",
    solarMarginKw: 0,
    minSolarGenerationKw: Number(opts.minGenKw) || 1,
    minExcessSolarKw: opts.minExcessKw ? Number(opts.minExcessKw) : null,
    gridVoltage: VOLTAGE,
    threePhaseCharger: false,
    consumptionExcludesCharging: false,
    gracePeriodMinutes: Number(opts.graceMin) || 6,
    cooldownPeriodMinutes: Number(opts.cooldownMin) || 15,
    ampDebounceThreshold: opts.ampDebounceThreshold ?? 2,
    ampDebounceSettleMinutes: opts.ampDebounceSettleMinutes ?? 3,
    batteryPriorityEnabled: opts.batteryPriorityEnabled,
    batteryPriorityLimit: opts.batteryPriorityLimit,
    priorityChargingEnabled: opts.waterfall,
    timezone: "",
  };
}

function initVehicleStates(
  vehicleConfigs: VehicleConfig[],
): Map<string, VehicleChargeState> {
  return new Map(
    vehicleConfigs.map((vc) => [vc.id, {
      vehicleId: vc.id,
      batteryLevel: vc.batteryStart,
      chargeLimit: vc.chargeLimit,
      isCharging: false,
      isPluggedIn: true,
      isOnline: true,
      chargeAmps: 0,
      chargeAmpsMax: vc.chargeAmpsMax,
      chargeAmpsMin: vc.chargeAmpsMin,
      chargePowerKw: 0,
      chargerVoltage: VOLTAGE,
      chargerPhases: 1,
      energyAddedKwh: 0,
      minutesToFull: 0,
      chargePortOpen: true,
      vehicleName: vc.name,
      lastUpdated: new Date().toISOString(),
      latitude: null,
      longitude: null,
      isHome: true,
    }]),
  );
}

function applyChargingEnergy(
  vehicleConfigs: VehicleConfig[],
  vehicleStates: Map<string, VehicleChargeState>,
): number {
  // accumulated across vehicles
  // deno-lint-ignore custom-no-let/no-let
  let totalChargingW = 0;
  // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
  for (const vc of vehicleConfigs) {
    const state = vehicleStates.get(vc.id);
    if (state && state.isCharging && state.chargeAmps > 0) {
      const kwh = (state.chargeAmps * VOLTAGE) / 1000 / 60;
      state.batteryLevel = Math.min(
        state.chargeLimit,
        state.batteryLevel + (kwh / vc.batteryCapacityKwh) * 100,
      );
      totalChargingW += state.chargeAmps * VOLTAGE;
    }
  }
  return totalChargingW;
}

function applyDecisions(
  vehicleConfigs: VehicleConfig[],
  vehicleStates: Map<string, VehicleChargeState>,
  output: ReturnType<ControllerEngine["decide"]>,
  reading: { minute: number; time: string },
): ControllerEvent[] {
  return vehicleConfigs.flatMap((vc): ControllerEvent[] => {
    const decision = output.decisions.get(vc.id);
    const vState = vehicleStates.get(vc.id);
    if (!decision || !vState) return [];

    if (decision.action === "start" || decision.action === "adjust_amps") {
      const wasCharging = vState.isCharging;
      vState.isCharging = true;
      vState.chargeAmps = decision.targetAmps ?? vState.chargeAmpsMin;
      vState.chargePowerKw = (vState.chargeAmps * VOLTAGE) / 1000;
      if (!wasCharging || decision.action === "adjust_amps") {
        return [{
          minute: reading.minute,
          time: reading.time,
          vehicleId: vc.id,
          vehicleName: vc.name,
          action: decision.action,
          detail: decision.detail,
          targetAmps: decision.targetAmps,
          checksJson: JSON.stringify(decision.checks),
        }];
      }
      return [];
    }
    if (decision.action === "stop") {
      const wasCharging = vState.isCharging;
      vState.isCharging = false;
      vState.chargeAmps = 0;
      vState.chargePowerKw = 0;
      if (wasCharging) {
        return [{
          minute: reading.minute,
          time: reading.time,
          vehicleId: vc.id,
          vehicleName: vc.name,
          action: "stop",
          detail: decision.detail,
          targetAmps: null,
          checksJson: JSON.stringify(decision.checks),
        }];
      }
    }
    return [];
  });
}

function snapshotVehicleResults(
  vehicleConfigs: VehicleConfig[],
  vehicleStates: Map<string, VehicleChargeState>,
): VehicleResult[] {
  return vehicleConfigs.map((vc) => {
    const state = vehicleStates.get(vc.id);
    const chargeAmps = state?.chargeAmps ?? 0;
    const isCharging = state?.isCharging ?? false;
    return {
      chargeAmps,
      chargePowerW: isCharging ? chargeAmps * VOLTAGE : 0,
      isCharging,
      batteryLevel: state?.batteryLevel ?? 0,
    };
  });
}

interface BatteryTick {
  batteryPowerW: number; // + = discharging, - = charging
  gridPowerW: number;
  soc: number;
}

// Self-consumption home battery: covers a deficit by discharging, absorbs a
// surplus by charging — capped by max rate and remaining capacity/headroom.
// `netW` is home + EV load minus solar production (positive = deficit).
function stepBattery(
  netW: number,
  soc: number,
  capacityKwh: number,
  maxRateW: number,
): BatteryTick {
  if (capacityKwh <= 0) return { batteryPowerW: 0, gridPowerW: netW, soc };

  const socWh = (soc / 100) * capacityKwh * 1000;
  const headroomWh = capacityKwh * 1000 - socWh;

  if (netW > 0) {
    const dischargeW = Math.min(netW, maxRateW, socWh * 60);
    return {
      batteryPowerW: dischargeW,
      gridPowerW: netW - dischargeW,
      soc: soc - (dischargeW / 60) / (capacityKwh * 1000) * 100,
    };
  }

  const chargeW = Math.min(-netW, maxRateW, headroomWh * 60);
  return {
    batteryPowerW: -chargeW,
    gridPowerW: netW + chargeW,
    soc: soc + (chargeW / 60) / (capacityKwh * 1000) * 100,
  };
}

// Run a full-day charge controller simulation using the pure decision
// engine. No database, no adapters, no service classes — just plain objects and the engine's decide() method.
export function runSimulation(
  opts: SimulationOptions,
): SimulationOutput {
  const vehicleConfigs = opts.vehicles;
  const config = buildControllerConfig(opts);
  const vehicleStates = initVehicleStates(vehicleConfigs);
  const engine = new ControllerEngine();
  const events: ControllerEvent[] = [];
  const results: SimResult[] = [];

  const solarDay = generateSolarDay({
    seed: opts.seed,
    peakKw: opts.peakSolarKw,
    cloudiness: opts.cloudiness,
    storms: opts.storms,
    homeBaseW: opts.homeLoad,
    sunrise: opts.sunrise,
    sunset: opts.sunset,
  });

  // incremented each simulation tick
  // deno-lint-ignore custom-no-let/no-let
  let simTimestamp = Date.now();
  // home battery state of charge, tracked across ticks
  // deno-lint-ignore custom-no-let/no-let
  let batterySoc = opts.batteryStartSoc;

  // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
  for (const reading of solarDay) {
    simTimestamp += 60_000;

    const totalChargingW = applyChargingEnergy(vehicleConfigs, vehicleStates);

    const netW = (reading.homeW + totalChargingW) - reading.solarW;
    const battery = stepBattery(
      netW,
      batterySoc,
      opts.batteryCapacityKwh,
      opts.batteryMaxRateKw * 1000,
    );
    batterySoc = battery.soc;

    const vehicles: EngineVehicleInput[] = vehicleConfigs.map((vc) => ({
      id: vc.id,
      vehicleId: vc.id,
      name: vc.name,
      mode: "auto" as const,
      priority: vc.priority,
      state: vehicleStates.get(vc.id) ?? null,
      isHome: true,
    }));

    const output = engine.decide({
      config,
      vehicles,
      schedules: [],
      energy: {
        solarProductionW: reading.solarW,
        gridPowerW: battery.gridPowerW,
        homeConsumptionW: reading.homeW + totalChargingW,
        batteryPowerW: opts.batteryCapacityKwh > 0
          ? battery.batteryPowerW
          : null,
        batterySoc: opts.batteryCapacityKwh > 0 ? batterySoc : null,
        gridVoltageV: null,
        lastUpdated: new Date(simTimestamp).toISOString(),
      },
      now: new Date(simTimestamp),
      timestamp: simTimestamp,
    });

    events.push(
      ...applyDecisions(vehicleConfigs, vehicleStates, output, reading),
    );

    const vehicleResults = snapshotVehicleResults(
      vehicleConfigs,
      vehicleStates,
    );

    results.push({
      minute: reading.minute,
      time: reading.time,
      solarW: reading.solarW,
      homeW: reading.homeW,
      gridW: battery.gridPowerW,
      excessW: Math.max(0, -battery.gridPowerW),
      batteryW: battery.batteryPowerW,
      batterySoc,
      vehicles: vehicleResults,
    });
  }

  return { results, events };
}
