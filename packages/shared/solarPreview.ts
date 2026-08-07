import type {
  DayOfWeek,
  EnergyData,
  Schedule,
  VehicleChargeState,
  VehicleMode,
} from "./types.ts";
import { ControllerEngine, SolarAllocator } from "./engine/mod.ts";
import type {
  ControllerConfig,
  DecisionReason,
  EngineSchedule,
  EngineVehicleInput,
} from "./engine/mod.ts";

/** Run the real ControllerEngine for a single simulated moment and derive the
 *  kW breakdown the Settings-page "Solar Charging Simulation" preview needs.
 *
 *  Every decision (start/stop, target amps, waterfall vs equal split, grace
 *  periods, thresholds, schedules, blockouts) comes straight from
 *  ControllerEngine/SolarAllocator. This file only turns the resulting amps
 *  into kilowatts and attributes them to solar vs grid for display — that is
 *  arithmetic, not a re-implementation of any decision. */

/** One vehicle's inputs for the preview. Mirrors the fields the real engine
 *  needs, plus its current charging draw — carried over so the engine's own
 *  add-back logic (SolarAllocator.addBackW) sees an already-charging vehicle
 *  the same way the live controller would. */
export interface PreviewVehicle {
  id: string;
  name: string;
  priority: number;
  mode: VehicleMode;
  batteryLevel: number;
  chargeLimit: number;
  chargeAmpsMin: number;
  chargeAmpsMax: number;
  chargerVoltage: number;
  chargerPhases: number;
  isCharging: boolean;
  chargeAmps: number;
}

export interface PreviewInputs {
  solarProductionKw: number;
  homeConsumptionKw: number;
  /** Positive = discharging (supplies power), negative = charging (draws
   *  power). Matches EnergyData.batteryPowerW. Null when there's no home
   *  battery to model. */
  batteryPowerKw: number | null;
  batterySoc: number | null;
  schedules: Schedule[];
  simulatedTime: string; // "HH:MM"
  simulatedDay: DayOfWeek;
}

export interface PreviewVehicleResult {
  id: string;
  name: string;
  action: "charging" | "skipped";
  /** The engine's own human-readable explanation for this decision. */
  reason: string;
  /** The engine's coded reason — for callers that need to branch on it. */
  reasonCode: DecisionReason;
  scheduleName?: string;
  allocatedAmps: number;
  allocatedKw: number;
  solarKw: number;
  gridKw: number;
}

export interface SolarPreviewResult {
  vehicles: PreviewVehicleResult[];
  totalChargingKw: number;
  gridImportKw: number;
  gridExportKw: number;
  blockoutActive: boolean;
}

// Reference week (2024-01-07 is a Sunday) used only to give isScheduleActiveNow
// a stable Date whose day-of-week/time-of-day match the preview's inputs.
const DAY_OFFSET: Record<DayOfWeek, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function simulatedNow(day: DayOfWeek, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2024, 0, 7 + DAY_OFFSET[day], hours || 0, minutes || 0, 0, 0);
}

function toEngineSchedule(s: Schedule): EngineSchedule {
  return {
    id: s.id,
    vehicleId: s.vehicleId,
    chargerId: s.chargerId,
    scheduleType: s.scheduleType,
    startTime: s.startTime,
    endTime: s.endTime,
    days: s.days,
    chargeAmps: s.scheduleType === "charge" ? s.chargeAmps : null,
    chargeLimitPct: s.scheduleType === "charge" ? s.chargeLimitPct : null,
    enabled: s.enabled,
  };
}

function toVehicleChargeState(
  v: PreviewVehicle,
  nowIso: string,
): VehicleChargeState {
  const chargeAmps = v.isCharging ? v.chargeAmps : 0;
  return {
    vehicleId: v.id,
    batteryLevel: v.batteryLevel,
    chargeLimit: v.chargeLimit,
    isCharging: v.isCharging,
    isPluggedIn: true,
    isOnline: true,
    chargeAmps,
    chargeAmpsMax: v.chargeAmpsMax,
    chargeAmpsMin: v.chargeAmpsMin,
    chargePowerKw: (chargeAmps * v.chargerVoltage * v.chargerPhases) / 1000,
    chargerVoltage: v.chargerVoltage,
    chargerPhases: v.chargerPhases,
    energyAddedKwh: 0,
    minutesToFull: 0,
    chargePortOpen: true,
    vehicleName: v.name,
    lastUpdated: nowIso,
    latitude: null,
    longitude: null,
    isHome: true,
  };
}

function toEnergyData(inputs: PreviewInputs, nowIso: string): EnergyData {
  const solarProductionW = inputs.solarProductionKw * 1000;
  const homeConsumptionW = inputs.homeConsumptionKw * 1000;
  const batteryPowerW = inputs.batteryPowerKw !== null
    ? inputs.batteryPowerKw * 1000
    : null;
  // Grid meter reading: consumption minus solar minus whatever the battery
  // contributes (positive battery power offsets import, negative adds to it).
  const gridPowerW = homeConsumptionW - solarProductionW - (batteryPowerW ?? 0);
  return {
    solarProductionW,
    gridPowerW,
    homeConsumptionW,
    batteryPowerW,
    batterySoc: inputs.batterySoc,
    gridVoltageV: null,
    lastUpdated: nowIso,
  };
}

export function previewSolarAllocation(
  config: ControllerConfig,
  vehicles: PreviewVehicle[],
  inputs: PreviewInputs,
): SolarPreviewResult {
  const now = simulatedNow(inputs.simulatedDay, inputs.simulatedTime);
  const nowIso = now.toISOString();
  const schedules = inputs.schedules.map(toEngineSchedule);
  const energy = toEnergyData(inputs, nowIso);

  const vehicleStates = new Map(
    vehicles.map((v) => [v.id, toVehicleChargeState(v, nowIso)] as const),
  );
  const engineVehicles: EngineVehicleInput[] = vehicles.map((v) => ({
    id: v.id,
    vehicleId: v.id,
    name: v.name,
    mode: v.mode,
    priority: v.priority,
    state: vehicleStates.get(v.id) ?? null,
  }));

  const engine = new ControllerEngine();
  const output = engine.decide({
    config,
    vehicles: engineVehicles,
    schedules,
    energy,
    now,
    timestamp: now.getTime(),
  });

  // Budget used only to attribute kW to "solar" vs "grid" for display. Starts
  // from the same solar surplus SolarAllocator itself starts from (net of
  // battery discharge, capped at panel output), so the split can't
  // double-count or exceed what the engine considered available.
  const remaining = {
    kw: Math.max(0, SolarAllocator.surplusW(energy, 0) / 1000),
  };

  const results: PreviewVehicleResult[] = [...vehicles]
    .sort((a, b) => a.priority - b.priority)
    .map((v): PreviewVehicleResult => {
      const decision = output.decisions.get(v.id);
      const state = vehicleStates.get(v.id);
      if (!decision || !state) {
        return {
          id: v.id,
          name: v.name,
          action: "skipped",
          reason: "No vehicle state",
          reasonCode: "no_state",
          allocatedAmps: 0,
          allocatedKw: 0,
          solarKw: 0,
          gridKw: 0,
        };
      }

      const startsOrAdjusts = decision.action === "start" ||
        decision.action === "adjust_amps";
      const staysCharging = decision.action === "none" && state.isCharging;
      const isCharging = startsOrAdjusts || staysCharging;

      if (!isCharging) {
        return {
          id: v.id,
          name: v.name,
          action: "skipped",
          reason: decision.detail,
          reasonCode: decision.reason,
          allocatedAmps: 0,
          allocatedKw: 0,
          solarKw: 0,
          gridKw: 0,
        };
      }

      const amps = decision.targetAmps ?? state.chargeAmps;
      const allocatedKw = (amps * v.chargerVoltage * v.chargerPhases) / 1000;
      const solarKw = Math.min(remaining.kw, allocatedKw);
      remaining.kw -= solarKw;
      const gridKw = allocatedKw - solarKw;

      return {
        id: v.id,
        name: v.name,
        action: "charging",
        reason: decision.detail,
        reasonCode: decision.reason,
        scheduleName: decision.reason === "schedule"
          ? `Scheduled charging at ${amps}A`
          : undefined,
        allocatedAmps: amps,
        allocatedKw,
        solarKw,
        gridKw,
      };
    });

  const totalChargingKw = results.reduce((sum, r) => sum + r.allocatedKw, 0);
  const batteryKw = inputs.batteryPowerKw ?? 0;
  const netKw = inputs.homeConsumptionKw + totalChargingKw -
    inputs.solarProductionKw - batteryKw;
  const blockoutActive = results.some((r) => r.reasonCode === "blockout");

  return {
    vehicles: results,
    totalChargingKw,
    gridImportKw: Math.max(0, netKw),
    gridExportKw: Math.max(0, -netKw),
    blockoutActive,
  };
}
