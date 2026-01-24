import {
  type ControllerAction,
  createTraceId,
  type EnergyData,
  type VehicleChargeState,
  type VehicleMode,
} from "@chargeha/shared";
import {
  ControllerEngine,
  DecisionChecks,
  isScheduleActiveNow,
} from "@chargeha/shared/engine";
import type {
  ControllerConfig,
  DecisionCheck,
  DecisionReason,
  EngineOutput,
  EngineVehicleInput,
  VehicleDecision,
} from "@chargeha/shared/engine";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type {
  ControllerLogInput,
  ScheduleRow,
  VehicleRow,
} from "../db/types.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { Logger } from "../lib/Logger.ts";

// Default loop interval (overridden by config)
const DEFAULT_LOOP_MS = 30_000;

// Prune old log entries every N loops
const PRUNE_EVERY_N_LOOPS = 100;

/** Structured inputs snapshot captured each decision cycle. */
export interface DecisionInputs {
  energy: {
    solarProductionW: number;
    gridPowerW: number;
    homeConsumptionW: number;
    batterySoc: number | null;
  } | null;
  vehicleState: {
    isPluggedIn: boolean;
    isCharging: boolean;
    batteryLevel: number;
    chargeLimit: number;
    chargeAmps: number;
    chargeAmpsMin: number;
    chargeAmpsMax: number;
    chargePowerKw: number;
    latitude: number | null;
    longitude: number | null;
  } | null;
  config: ControllerConfig;
  activeSchedules: Array<{
    id: string;
    type: string;
    startTime: string;
    endTime: string;
  }>;
}

/** Decision log entry built per vehicle per loop iteration. */
interface DecisionLogEntry {
  vehicleId: string;
  vehicleName: string;
  mode: VehicleMode;
  inputs: DecisionInputs;
  checks: DecisionCheck[];
  action: ControllerAction;
  reason: DecisionReason;
  actionDetail: string;
  targetAmps: number | null;
  /** When true, polling can be suspended for this vehicle. */
  suspendable?: boolean;
  /** Set when a charge schedule's limit was reached and the decision fell through. */
  scheduleLimitContext?: { scheduleLimitPct: number; batteryLevel: number };
}

export class ChargeController {
  private readonly vehicleManager: VehicleManager;
  private readonly poller: EnergyPoller;
  private readonly db: AppDatabase;
  private readonly configService: ConfigService;
  private readonly eventEmitter: TypedEventEmitter;
  private readonly logger: Logger;
  private readonly engine = new ControllerEngine();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loopCount = 0;

  constructor(
    vehicleManager: VehicleManager,
    poller: EnergyPoller,
    db: AppDatabase,
    configService: ConfigService,
    eventEmitter: TypedEventEmitter,
    logger: Logger,
  ) {
    this.vehicleManager = vehicleManager;
    this.poller = poller;
    this.db = db;
    this.configService = configService;
    this.eventEmitter = eventEmitter;
    this.logger = logger;
    this.start();
  }

  private start(): void {
    this.logger.info("Started");
    this.scheduleNext(DEFAULT_LOOP_MS);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.loop();
    }, delayMs);
  }

  /** Run a single iteration of the control loop without scheduling the next.
   *  Used by the simulator to step the controller one tick at a time.
   *  Returns the loaded config so the loop scheduler can read controllerLoopSeconds
   *  without a redundant DB round-trip. */
  async runOnce(): Promise<ControllerConfig> {
    const traceId = createTraceId();
    const config = await this.loadConfig();
    const vehicles = await this.db.getVehicles();
    const schedules = await this.db.getSchedules();
    const energySnapshot = this.poller.tryGetRealtimeSnapshot();
    const now = new Date();
    const energy = energySnapshot?.realtime ?? null;
    const solarW = energy && Math.round(energy.solarProductionW);
    const gridW = energy && Math.round(energy.gridPowerW);
    const energySummary = energy ? `solar=${solarW}W grid=${gridW}W` : "none";
    this.logger.debug(
      `Loop: ${vehicles.length} vehicles, ${schedules.length} schedules, energy=${energySummary}`,
    );

    // Compute context for middleware requests
    const hasSolar = energy !== null &&
      energy.solarProductionW >= config.minSolarGenerationKw * 1000;
    const hasBlockout = schedules.some(
      (s) => this.isActiveBlockout(s, now, config.timezone),
    );

    // Request fresh state for each vehicle via middleware
    const engineVehicles: EngineVehicleInput[] = await Promise.all(
      vehicles.map(async (v) => {
        const applicable = schedules.filter((s) =>
          this.isScheduleApplicable(s, v.id, now, config.timezone)
        );
        const activeChargeSchedule = applicable.find(
          (s) => s.scheduleType === "charge",
        );
        await this.vehicleManager.requestState(v.id, {
          origin: "controller",
          traceId,
          hasSolar,
          hasSchedule: applicable.length > 0,
          hasBlockout,
          scheduleChargeLimitPct: activeChargeSchedule?.chargeLimitPct ?? null,
        });
        const state = await this.vehicleManager.getState(v.id);
        return {
          id: v.id,
          name: v.name,
          mode: v.mode,
          priority: v.priority,
          state,
        };
      }),
    );

    // Run the pure decision engine
    const output = this.engine.decide({
      config,
      vehicles: engineVehicles,
      schedules,
      energy,
      now,
      timestamp: Date.now(),
    });

    // Execute decisions, build log entries, emit events
    const logEntries: ControllerLogInput[] = await vehicles.reduce(
      async (prevPromise, vehicle) => {
        const acc = await prevPromise;
        const decision = output.decisions.get(vehicle.id);
        if (!decision) return acc;
        const logInput = await this.processVehicleDecision(
          vehicle,
          decision,
          output,
          config,
          schedules,
          energy,
          now,
          traceId,
        );
        return [...acc, logInput];
      },
      Promise.resolve([] as ControllerLogInput[]),
    );

    // Batch-insert log entries
    if (logEntries.length > 0) {
      await this.db.insertControllerLogEntries(logEntries);
    }

    // Periodic pruning
    this.loopCount++;
    if (this.loopCount % PRUNE_EVERY_N_LOOPS === 0) {
      const system = await this.configService.getSystem();
      await this.db.pruneControllerLogs(system.logRetentionDays);
    }

    return config;
  }

  /** Execute a decision by issuing the appropriate adapter command. */
  private async executeDecision(
    vehicleId: string,
    decision: VehicleDecision,
    state: VehicleChargeState | null,
    traceId: string,
  ): Promise<void> {
    if (!state) return;

    const ctx = { origin: `controller:${decision.reason}`, traceId };
    switch (decision.action) {
      case "start":
      case "adjust_amps":
        if (decision.targetAmps !== null) {
          await this.vehicleManager.startChargingAt(
            vehicleId,
            decision.targetAmps,
            ctx,
            state,
          );
        }
        break;
      case "stop":
        await this.vehicleManager.stopCharging(
          vehicleId,
          ctx,
          state,
        );
        break;
    }
  }

  /** Execute a single vehicle's decision and produce its log entry.
   *  Handles: adapter commands, polling suspension, event emission,
   *  transition tracking. */
  private async processVehicleDecision(
    vehicle: VehicleRow,
    decision: VehicleDecision,
    output: EngineOutput,
    config: ControllerConfig,
    schedules: ScheduleRow[],
    energy: EnergyData | null,
    now: Date,
    traceId: string,
  ): Promise<ControllerLogInput> {
    const state = await this.vehicleManager.getState(vehicle.id);
    const preState = state;

    await this.executeDecision(vehicle.id, decision, state, traceId);

    const inputs = this.buildInputsSnapshot(
      state,
      config,
      schedules,
      energy,
      now,
    );
    const checks = [...decision.checks];
    const cs = this.engine.getControlState(vehicle.id);

    // Add allocation check when multi-vehicle allocation is active
    if (cs.allocatedAmps !== null) {
      const mode = config.priorityChargingEnabled ? "waterfall" : "equal";
      const totalAmps = [...output.decisions.keys()]
        .map((id) => this.engine.getControlState(id).allocatedAmps ?? 0)
        .reduce((sum, a) => sum + a, 0);
      checks.push(DecisionChecks.solarAllocation(
        cs.allocatedAmps,
        totalAmps,
        mode,
        vehicle.priority,
      ));
    }

    const entry: DecisionLogEntry = {
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      mode: vehicle.mode,
      inputs,
      checks,
      action: decision.action,
      reason: decision.reason,
      actionDetail: decision.detail,
      targetAmps: decision.targetAmps,
      suspendable: decision.suspendable,
      scheduleLimitContext: decision.scheduleLimitContext,
    };

    this.emitControllerStatus(vehicle.id, entry);

    // Post-command state (may differ from preState after commands)
    const postState = await this.vehicleManager.getState(vehicle.id);

    if (!cs.initialized) {
      cs.initialized = true;
      cs.lastActiveScheduleIds = new Set(
        schedules
          .filter((s) =>
            this.isScheduleApplicable(s, vehicle.id, now, config.timezone)
          )
          .map((s) => s.id),
      );
    } else {
      this.emitControllerEvents(
        vehicle,
        preState,
        postState,
        entry,
        schedules,
        now,
        config.timezone,
        config.gracePeriodMinutes,
      );
    }
    cs.prevState = postState;

    return {
      vehicleId: entry.vehicleId,
      vehicleName: entry.vehicleName,
      mode: entry.mode,
      inputsJson: JSON.stringify(entry.inputs),
      checksJson: JSON.stringify(entry.checks),
      action: entry.action,
      actionDetail: entry.actionDetail,
      targetAmps: entry.targetAmps,
      traceId,
    };
  }

  private async loop(): Promise<void> {
    const nextIntervalMs = await this.runOnce()
      .then((config) => config.controllerLoopSeconds * 1000)
      .catch((error) => {
        this.logger.error("Loop error:", error);
        return DEFAULT_LOOP_MS;
      });

    this.scheduleNext(nextIntervalMs);
  }

  /** Push the latest controller decision to the frontend via SSE. */
  private emitControllerStatus(
    vehicleId: string,
    entry: DecisionLogEntry,
  ): void {
    this.eventEmitter.emit("controller_status", {
      vehicleId,
      action: entry.action,
      reason: entry.reason,
      detail: entry.actionDetail,
      targetAmps: entry.targetAmps,
      checksJson: JSON.stringify(entry.checks),
    }, vehicleId);
  }

  /** Detect state transitions and emit controller events.
   *  @param preState   — polled state at the start of this loop (before commands)
   *  @param postState  — state after commands (may differ from preState) */
  private emitControllerEvents(
    vehicle: VehicleRow,
    preState: VehicleChargeState | null,
    postState: VehicleChargeState | null,
    entry: DecisionLogEntry,
    schedules: ScheduleRow[],
    now: Date,
    timezone: string,
    gracePeriodMinutes: number,
  ): void {
    const controlState = this.engine.getControlState(vehicle.id);
    const prevState = controlState.prevState;

    const wasCharging = prevState?.isCharging ?? false;
    const isPolledCharging = preState?.isCharging ?? false;
    const isNowCharging = postState?.isCharging ?? false;

    // External charge: vehicle is charging but the engine actively wants to
    // stop it (no schedule, no solar, blockout, mode_stop, idle, etc.).
    // The engine encodes "should not charge while charging" as action=stop,
    // so trusting that signal avoids false positives when the engine is
    // happy with the existing charge (charge_now/adjust_amps/none).
    if (isPolledCharging && !wasCharging && entry.action === "stop") {
      this.eventEmitter.emit("controller_external_charge", {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
      });
    }

    // Controller started charging: not charging at start → charging after commands
    if (isNowCharging && !isPolledCharging && entry.action === "start") {
      this.eventEmitter.emit("controller_charge_started", {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        actionDetail: entry.actionDetail,
        reason: entry.reason,
      });
    }

    // Charging stopped: fire when controller decides stop OR battery just
    // reached its charge limit (vehicle may stop on its own at the limit).
    // Listener routes to "Charge Complete" message when reason is
    // battery_at_limit, "Charging Stopped" otherwise.
    const wasAtLimit = prevState
      ? prevState.batteryLevel >= prevState.chargeLimit
      : false;
    const nowAtLimit = preState
      ? preState.batteryLevel >= preState.chargeLimit
      : false;
    const justHitLimit = nowAtLimit && !wasAtLimit;
    if (entry.action === "stop" || justHitLimit) {
      this.eventEmitter.emit("controller_charge_stopped", {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        actionDetail: entry.actionDetail,
        reason: justHitLimit ? "battery_at_limit" : entry.reason,
        batteryLevel: preState?.batteryLevel,
        chargeLimit: preState?.chargeLimit,
        scheduleLimitContext: entry.scheduleLimitContext,
      });
    }

    // Low solar: grace period just started
    if (controlState.graceStartedAt !== null && !controlState.graceNotified) {
      controlState.graceNotified = true;
      this.eventEmitter.emit("controller_low_solar", {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        gracePeriodMinutes,
      });
    }

    // Schedule activation: new schedule IDs not active last cycle
    const activeScheduleIds = new Set<string>(
      schedules
        .filter((s) => this.isScheduleApplicable(s, vehicle.id, now, timezone))
        .map((s) => s.id),
    );
    const newlyActiveSchedules = [...activeScheduleIds]
      .filter((id) => !controlState.lastActiveScheduleIds.has(id))
      .map((id) => schedules.find((s) => s.id === id))
      .filter((s): s is ScheduleRow => s !== undefined);

    if (newlyActiveSchedules.length > 0) {
      newlyActiveSchedules.forEach((sched) => {
        this.eventEmitter.emit("controller_schedule_activated", {
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          scheduleType: sched.scheduleType,
          startTime: sched.startTime,
          endTime: sched.endTime,
          isPluggedIn: postState?.isPluggedIn ?? false,
          isHome: postState?.isHome ?? null,
        });
      });
    }
    controlState.lastActiveScheduleIds = activeScheduleIds;
  }

  private buildInputsSnapshot(
    state: VehicleChargeState | null,
    config: ControllerConfig,
    schedules: ScheduleRow[],
    energy: EnergyData | null,
    now: Date,
  ): DecisionLogEntry["inputs"] {
    const activeSchedules = schedules
      .filter((s) => s.enabled && isScheduleActiveNow(s, now, config.timezone))
      .map((s) => ({
        id: s.id,
        type: s.scheduleType,
        startTime: s.startTime,
        endTime: s.endTime,
      }));

    return {
      energy: this.mapEnergyInputs(energy),
      vehicleState: this.mapVehicleStateInputs(state),
      config,
      activeSchedules,
    };
  }

  private mapEnergyInputs(
    energy: EnergyData | null,
  ): DecisionLogEntry["inputs"]["energy"] {
    if (!energy) return null;
    return {
      solarProductionW: energy.solarProductionW,
      gridPowerW: energy.gridPowerW,
      homeConsumptionW: energy.homeConsumptionW,
      batterySoc: energy.batterySoc,
    };
  }

  private mapVehicleStateInputs(
    state: VehicleChargeState | null,
  ): DecisionLogEntry["inputs"]["vehicleState"] {
    if (!state) return null;
    return {
      isPluggedIn: state.isPluggedIn,
      isCharging: state.isCharging,
      batteryLevel: state.batteryLevel,
      chargeLimit: state.chargeLimit,
      chargeAmps: state.chargeAmps,
      chargeAmpsMin: state.chargeAmpsMin,
      chargeAmpsMax: state.chargeAmpsMax,
      chargePowerKw: state.chargePowerKw,
      latitude: state.latitude,
      longitude: state.longitude,
    };
  }

  private isScheduleApplicable(
    s: ScheduleRow,
    vehicleId: string,
    now: Date,
    timezone: string,
  ): boolean {
    if (!s.enabled || !isScheduleActiveNow(s, now, timezone)) return false;
    return s.scheduleType === "blockout" || s.vehicleId === vehicleId ||
      s.vehicleId === null;
  }

  private isActiveBlockout(
    s: ScheduleRow,
    now: Date,
    timezone: string,
  ): boolean {
    return s.scheduleType === "blockout" && s.enabled &&
      isScheduleActiveNow(s, now, timezone);
  }

  private async loadConfig(): Promise<ControllerConfig> {
    const [charging, solar, battery, system] = await Promise.all([
      this.configService.getCharging(),
      this.configService.getSolar(),
      this.configService.getBattery(),
      this.configService.getSystem(),
    ]);

    return {
      chargingEnabled: charging.chargingEnabled,
      controllerLoopSeconds: system.controllerLoopSeconds,
      solarTrackingEnabled: solar.solarTrackingEnabled,
      solarTrackingMode: solar.solarTrackingMode,
      solarReference: solar.solarReference,
      solarMarginKw: solar.solarMarginKw,
      minSolarGenerationKw: solar.minSolarGenerationKw,
      minExcessSolarKw: solar.minExcessSolarKw,
      gridVoltage: solar.gridVoltage,
      threePhaseCharger: solar.threePhaseCharger,
      consumptionExcludesCharging: solar.consumptionExcludesCharging,
      gracePeriodMinutes: solar.gracePeriodMinutes,
      cooldownPeriodMinutes: solar.cooldownPeriodMinutes,
      ampDebounceThreshold: solar.ampDebounceThreshold,
      ampDebounceSettleMinutes: solar.ampDebounceSettleMinutes,
      batteryPriorityEnabled: battery.batteryPriorityEnabled,
      batteryPriorityLimit: battery.batteryPriorityLimit,
      priorityChargingEnabled: charging.priorityChargingEnabled,
      timezone: system.timezone,
    };
  }
}
