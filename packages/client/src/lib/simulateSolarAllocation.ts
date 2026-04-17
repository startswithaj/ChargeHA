import type {
  ChargeSchedule,
  DayOfWeek,
  Schedule,
  VehicleMode,
} from "@chargeha/shared";

// ── Types ──

export interface SolarConfig {
  solarTrackingEnabled: boolean;
  solarTrackingMode: "solar_only" | "solar_grid";
  solarReference: "excess" | "gross";
  solarMarginKw: number;
  minSolarGenerationKw: number;
  minExcessSolarKw: number | null;
  gridVoltage: number;
  threePhaseCharger: boolean;
  batteryPriorityEnabled: boolean;
  batteryPriorityLimit: number;
}

export interface SimVehicle {
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
}

export interface SimInputs {
  solarProductionKw: number;
  homeConsumptionKw: number;
  batterySoc: number | null;
  schedules?: Schedule[];
  simulatedTime?: string; // "HH:MM" format
  simulatedDay?: DayOfWeek;
}

export interface VehicleAllocation {
  id: string;
  name: string;
  action: "charging" | "skipped";
  allocatedAmps: number;
  allocatedKw: number;
  solarKw: number;
  gridKw: number;
  reason: string;
  scheduleName?: string;
}

export interface SimulationResult {
  vehicles: VehicleAllocation[];
  availableSolarKw: number;
  totalChargingKw: number;
  gridImportKw: number;
  gridExportKw: number;
  meetsMinSolarGeneration: boolean;
  meetsMinExcessSolar: boolean;
  batteryPriorityBlocking: boolean;
  blockoutActive: boolean;
}

// ── Schedule helpers ──

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Check whether a point-in-time falls within a start–end time range.
 * Handles overnight ranges (e.g. 23:00–06:00).
 */
export function isTimeInRange(
  time: string,
  start: string,
  end: string,
): boolean {
  const t = toMinutes(time);
  const s = toMinutes(start);
  const e = toMinutes(end);

  if (s === e) return false; // zero-length range
  if (e > s) {
    // Normal range (e.g. 09:00–17:00)
    return t >= s && t < e;
  }
  // Overnight range (e.g. 23:00–06:00) — split into [s, 1440) and [0, e)
  return t >= s || t < e;
}

export interface ActiveSchedules {
  blockoutActive: boolean;
  vehicleChargeSchedules: Map<string, ChargeSchedule>;
}

/**
 * Determine which schedules are active at a given time and day.
 */
export function findActiveSchedules(
  schedules: Schedule[],
  time: string,
  day: DayOfWeek,
): ActiveSchedules {
  const active = schedules.filter((s) =>
    s.enabled && s.days.includes(day) &&
    isTimeInRange(time, s.startTime, s.endTime)
  );

  return {
    blockoutActive: active.some((s) => s.scheduleType === "blockout"),
    vehicleChargeSchedules: new Map(
      active
        .filter((s): s is ChargeSchedule => s.scheduleType === "charge")
        .map((s) => [s.vehicleId, s]),
    ),
  };
}

// ── Config parser ──

export function parseConfigToSolarConfig(
  config: Record<string, string>,
): SolarConfig {
  const minExcess = parseFloat(config.min_excess_solar_kw ?? "");
  return {
    solarTrackingEnabled: config.solar_tracking_enabled === "true",
    solarTrackingMode:
      (config.solar_tracking_mode as "solar_only" | "solar_grid") ??
        "solar_only",
    solarReference: (config.solar_reference as "excess" | "gross") ?? "excess",
    solarMarginKw: parseFloat(config.solar_margin_kw ?? "0"),
    minSolarGenerationKw: parseFloat(config.min_solar_generation_kw ?? "0.2"),
    minExcessSolarKw: isNaN(minExcess) ? null : minExcess,
    gridVoltage: parseInt(config.grid_voltage ?? "230"),
    threePhaseCharger: config.three_phase_charger === "true",
    batteryPriorityEnabled: config.battery_priority_enabled === "true",
    batteryPriorityLimit: parseInt(config.battery_priority_limit ?? "80"),
  };
}

// ── Per-vehicle allocation ──

interface AllocCtx {
  config: SolarConfig;
  vehicleChargeSchedules: Map<string, ChargeSchedule>;
  blockoutActive: boolean;
  thresholdsBlocking: boolean;
  meetsMinSolarGeneration: boolean;
  meetsMinExcessSolar: boolean;
  batteryPriorityBlocking: boolean;
  batterySoc: number | null;
}

interface AllocState {
  remainingSolarKw: number;
  totalChargingKw: number;
}

function makeSkip(v: SimVehicle, reason: string, scheduleName?: string) {
  return {
    id: v.id,
    name: v.name,
    action: "skipped" as const,
    allocatedAmps: 0,
    allocatedKw: 0,
    solarKw: 0,
    gridKw: 0,
    reason,
    ...(scheduleName ? { scheduleName } : {}),
  };
}

function makeCharge(
  v: SimVehicle,
  amps: number,
  voltagePerPhase: number,
  remainingSolarKw: number,
  reason: string,
  scheduleName?: string,
  solarOnly = false,
) {
  const powerKw = (amps * voltagePerPhase) / 1000;
  const solarUsed = solarOnly ? powerKw : Math.min(remainingSolarKw, powerKw);
  const gridUsed = powerKw - solarUsed;
  const allocation: VehicleAllocation = {
    id: v.id,
    name: v.name,
    action: "charging",
    allocatedAmps: amps,
    allocatedKw: powerKw,
    solarKw: solarUsed,
    gridKw: gridUsed,
    reason,
    ...(scheduleName ? { scheduleName } : {}),
  };
  return { allocation, powerKw, solarUsed };
}

function resolveBlockReason(ctx: AllocCtx): string {
  if (!ctx.meetsMinSolarGeneration) {
    return `Solar generation below ${ctx.config.minSolarGenerationKw} kW minimum`;
  }
  if (!ctx.meetsMinExcessSolar) {
    return `Excess solar below ${ctx.config.minExcessSolarKw} kW minimum`;
  }
  if (ctx.batteryPriorityBlocking) {
    return `Battery (${ctx.batterySoc}%) below priority limit (${ctx.config.batteryPriorityLimit}%)`;
  }
  return "Solar thresholds not met";
}

function applyCharge(
  state: AllocState,
  charge: { powerKw: number; solarUsed: number },
): AllocState {
  return {
    remainingSolarKw: Math.max(0, state.remainingSolarKw - charge.solarUsed),
    totalChargingKw: state.totalChargingKw + charge.powerKw,
  };
}

function allocateOne(
  v: SimVehicle,
  ctx: AllocCtx,
  state: AllocState,
): { allocation: VehicleAllocation; state: AllocState } {
  if (v.mode === "stop") {
    return { allocation: makeSkip(v, "Mode set to stop"), state };
  }
  if (v.batteryLevel >= v.chargeLimit) {
    return { allocation: makeSkip(v, "Battery at charge limit"), state };
  }

  const phases = ctx.config.threePhaseCharger ? 3 : v.chargerPhases;
  const voltagePerPhase = ctx.config.gridVoltage * phases;

  const chargeSchedule = ctx.vehicleChargeSchedules.get(v.id);
  if (chargeSchedule && v.mode === "auto") {
    const scheduleName = `Scheduled charging at ${chargeSchedule.chargeAmps}A`;
    if (v.batteryLevel >= chargeSchedule.chargeLimitPct) {
      return {
        allocation: makeSkip(
          v,
          "Battery at schedule charge limit",
          scheduleName,
        ),
        state,
      };
    }
    const amps = Math.min(chargeSchedule.chargeAmps, v.chargeAmpsMax);
    const charge = makeCharge(
      v,
      amps,
      voltagePerPhase,
      state.remainingSolarKw,
      scheduleName,
      scheduleName,
    );
    return { allocation: charge.allocation, state: applyCharge(state, charge) };
  }

  if (ctx.blockoutActive && v.mode === "auto") {
    return { allocation: makeSkip(v, "Blockout schedule active"), state };
  }

  if (v.mode === "charge_now") {
    const charge = makeCharge(
      v,
      v.chargeAmpsMax,
      voltagePerPhase,
      state.remainingSolarKw,
      "Charge now at max amps",
    );
    return { allocation: charge.allocation, state: applyCharge(state, charge) };
  }

  if (ctx.thresholdsBlocking) {
    return { allocation: makeSkip(v, resolveBlockReason(ctx)), state };
  }

  // Auto mode — solar tracking
  const availableW = state.remainingSolarKw * 1000;
  const rawAmps = availableW / voltagePerPhase;
  const clampedAmps = Math.min(Math.max(rawAmps, 0), v.chargeAmpsMax);

  if (clampedAmps >= v.chargeAmpsMin) {
    const amps = Math.floor(clampedAmps);
    if (amps < v.chargeAmpsMin) {
      return {
        allocation: makeSkip(v, "Insufficient solar for minimum amps"),
        state,
      };
    }
    const charge = makeCharge(
      v,
      amps,
      voltagePerPhase,
      state.remainingSolarKw,
      "Solar charging",
      undefined,
      true,
    );
    return { allocation: charge.allocation, state: applyCharge(state, charge) };
  }

  if (ctx.config.solarTrackingMode === "solar_grid") {
    const charge = makeCharge(
      v,
      v.chargeAmpsMin,
      voltagePerPhase,
      state.remainingSolarKw,
      "Solar + grid at minimum amps",
    );
    return { allocation: charge.allocation, state: applyCharge(state, charge) };
  }

  return {
    allocation: makeSkip(v, "Insufficient solar for minimum amps"),
    state,
  };
}

function computeActiveSchedules(inputs: SimInputs): ActiveSchedules {
  if (!inputs.schedules || !inputs.simulatedTime || !inputs.simulatedDay) {
    return {
      blockoutActive: false,
      vehicleChargeSchedules: new Map<string, ChargeSchedule>(),
    };
  }
  return findActiveSchedules(
    inputs.schedules,
    inputs.simulatedTime,
    inputs.simulatedDay,
  );
}

// ── Simulation ──

export function simulateSolarAllocation(
  config: SolarConfig,
  vehicles: SimVehicle[],
  inputs: SimInputs,
): SimulationResult {
  const { solarProductionKw, homeConsumptionKw, batterySoc } = inputs;

  const excessKw = solarProductionKw - homeConsumptionKw;
  const rawAvailable = config.solarReference === "gross"
    ? solarProductionKw
    : excessKw;

  const meetsMinSolarGeneration =
    solarProductionKw >= config.minSolarGenerationKw;
  const meetsMinExcessSolar = config.minExcessSolarKw === null ||
    excessKw >= config.minExcessSolarKw;
  const batteryBelowLimit = batterySoc !== null &&
    batterySoc < config.batteryPriorityLimit;
  const batteryPriorityBlocking = config.batteryPriorityEnabled &&
    batteryBelowLimit;

  // If battery is below priority limit, no solar available for EVs
  const availableSolarKw = batteryPriorityBlocking
    ? 0
    : Math.max(0, rawAvailable - config.solarMarginKw);

  const thresholdsBlocking = !meetsMinSolarGeneration || !meetsMinExcessSolar ||
    batteryPriorityBlocking;

  const activeSchedules = computeActiveSchedules(inputs);

  const ctx: AllocCtx = {
    config,
    vehicleChargeSchedules: activeSchedules.vehicleChargeSchedules,
    blockoutActive: activeSchedules.blockoutActive,
    thresholdsBlocking,
    meetsMinSolarGeneration,
    meetsMinExcessSolar,
    batteryPriorityBlocking,
    batterySoc,
  };

  const sorted = [...vehicles].sort((a, b) => a.priority - b.priority);

  const final = sorted.reduce<
    { allocations: VehicleAllocation[]; state: AllocState }
  >(
    (acc, v) => {
      const { allocation, state } = allocateOne(v, ctx, acc.state);
      return { allocations: [...acc.allocations, allocation], state };
    },
    {
      allocations: [],
      state: { remainingSolarKw: availableSolarKw, totalChargingKw: 0 },
    },
  );

  const totalChargingKw = final.state.totalChargingKw;
  const gridImportKw = Math.max(
    0,
    homeConsumptionKw + totalChargingKw - solarProductionKw,
  );
  const gridExportKw = Math.max(
    0,
    solarProductionKw - homeConsumptionKw - totalChargingKw,
  );

  return {
    vehicles: final.allocations,
    availableSolarKw,
    totalChargingKw,
    gridImportKw,
    gridExportKw,
    meetsMinSolarGeneration,
    meetsMinExcessSolar,
    batteryPriorityBlocking,
    blockoutActive: activeSchedules.blockoutActive,
  };
}
