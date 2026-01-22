import type {
  ControllerAction,
  DayOfWeek,
  EnergyData,
  ScheduleType,
  SolarReference,
  SolarTrackingMode,
  VehicleChargeState,
  VehicleMode,
} from "../types.ts";
import type { DecisionCheck } from "./DecisionChecks.ts";

// ---- Engine input types ----

/** All config keys the engine needs to make decisions.
 *  Assembled from the DB by ChargeController.loadConfig(), or constructed
 *  directly by the simulator. */
export interface ControllerConfig {
  chargingEnabled: boolean;
  controllerLoopSeconds: number;
  solarTrackingEnabled: boolean;
  solarTrackingMode: SolarTrackingMode;
  solarReference: SolarReference;
  solarMarginKw: number;
  minSolarGenerationKw: number;
  minExcessSolarKw: number | null;
  gridVoltage: number;
  threePhaseCharger: boolean;
  consumptionExcludesCharging: boolean;
  gracePeriodMinutes: number;
  cooldownPeriodMinutes: number;
  batteryPriorityEnabled: boolean;
  batteryPriorityLimit: number;
  priorityChargingEnabled: boolean;
  timezone: string;
  ampDebounceThreshold: number;
  ampDebounceSettleMinutes: number;
}

/** Vehicle identity + config fields the engine needs. Flattened from the
 *  database VehicleRow — only the fields relevant to decision-making. */
export interface EngineVehicleInput {
  id: string;
  name: string;
  mode: VehicleMode;
  priority: number;
  state: VehicleChargeState | null;
}

/** Schedule fields the engine needs. Mirrors ScheduleRow minus DB
 *  bookkeeping columns (createdAt/updatedAt). */
export interface EngineSchedule {
  id: string;
  vehicleId: string | null;
  scheduleType: ScheduleType;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  chargeAmps: number | null;
  chargeLimitPct: number | null;
  enabled: boolean;
}

/** Everything the engine needs to make decisions for one loop iteration. */
export interface EngineInput {
  config: ControllerConfig;
  vehicles: EngineVehicleInput[];
  schedules: EngineSchedule[];
  energy: EnergyData | null;
  now: Date;
  /** Monotonic timestamp in ms (replaces Date.now() calls inside the engine). */
  timestamp: number;
}

// ---- Per-vehicle runtime state ----

/** Per-vehicle runtime state tracked across loop iterations.
 *  Owned by the engine — the orchestrator stores it but doesn't interpret it. */
export interface VehicleControlState {
  /** False until the first cycle observes actual vehicle state. Transition
   *  notifications are suppressed until initialized to avoid false positives
   *  after a server restart. */
  initialized: boolean;
  /** Vehicle state snapshot from the end of the previous loop. Used by
   *  emitNotifications to detect transitions (both external and controller-driven). */
  prevState: VehicleChargeState | null;
  graceStartedAt: number | null;
  graceNotified: boolean;
  cooldownUntil: number | null;
  lastActiveScheduleIds: Set<string>;
  blockoutChargeNotified: boolean;
  pollingSuspended: boolean;
  /** Pre-computed solar allocation for this vehicle. Set each loop by
   *  calculateSolarAllocation, read by processSolarTracking. */
  allocatedAmps: number | null;
  /** The debounced target amps being tracked. Set when a small amp change
   *  is within the debounce threshold and waiting to settle. */
  pendingAmps: number | null;
  /** Timestamp (ms) when pendingAmps was first seen. Used by debounceAmps
   *  to determine if the target has been stable long enough to apply. */
  pendingSince: number | null;
}

// ---- Engine output types ----

/** Why the engine made this decision. Used by the UI to render
 *  user-friendly status messages without string-matching on detail. */
export type DecisionReason =
  | "solar_tracking"
  | "schedule"
  | "blockout"
  | "charge_now"
  | "mode_stop"
  | "battery_priority"
  | "grace_period"
  | "cooldown"
  | "no_solar"
  | "charging_disabled"
  | "battery_at_limit"
  | "not_plugged_in"
  | "away_from_home"
  | "no_state"
  | "idle";

/** A single vehicle's decision — what to do, not how to do it. */
export interface VehicleDecision {
  action: ControllerAction;
  reason: DecisionReason;
  detail: string;
  targetAmps: number | null;
  checks: DecisionCheck[];
  /** When true, polling can be suspended — charging is not possible. */
  suspendable?: boolean;
  /** Set when a charge schedule's limit was reached and the decision fell through. */
  scheduleLimitContext?: { scheduleLimitPct: number; batteryLevel: number };
}

/** Full output from one engine.decide() call. */
export interface EngineOutput {
  decisions: Map<string, VehicleDecision>;
  controlStates: Map<string, VehicleControlState>;
}

/** Fields of VehicleControlState that evaluation steps may update.
 *  Returned by pipeline methods instead of mutating the state directly. */
export type ControlStateUpdates = Partial<
  Pick<
    VehicleControlState,
    | "graceStartedAt"
    | "graceNotified"
    | "cooldownUntil"
    | "blockoutChargeNotified"
    | "pendingAmps"
    | "pendingSince"
  >
>;

/** The subset of VehicleDecision that pipeline steps produce.
 *  The caller adds checks, scheduleLimitContext after assembling all steps. */
export type PipelineDecision = Omit<
  VehicleDecision,
  "checks" | "scheduleLimitContext"
>;

/** Result of an evaluation step in the decision pipeline.
 *  When `decision` is null, the step did not apply — try the next step. */
export interface EvalResult {
  decision: PipelineDecision | null;
  checks: DecisionCheck[];
  scheduleLimitContext?: { scheduleLimitPct: number; batteryLevel: number };
  stateUpdates?: ControlStateUpdates;
}

/** Result from the amp debounce calculation. The caller applies
 *  pendingAmps/pendingSince to the VehicleControlState. */
export interface DebounceResult {
  amps: number;
  pendingAmps: number | null;
  pendingSince: number | null;
}

// ---- Factory ----

/** Create a fresh VehicleControlState with default values. */
export function createControlState(): VehicleControlState {
  return {
    initialized: false,
    prevState: null,
    graceStartedAt: null,
    graceNotified: false,
    cooldownUntil: null,
    lastActiveScheduleIds: new Set<string>(),
    blockoutChargeNotified: false,
    pollingSuspended: false,
    allocatedAmps: null,
    pendingAmps: null,
    pendingSince: null,
  };
}
