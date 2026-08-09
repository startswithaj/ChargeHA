import type { EnergyData, VehicleChargeState } from "../types.ts";
import { SolarAllocator } from "./SolarAllocator.ts";
import { DecisionChecks } from "./DecisionChecks.ts";
import type { DecisionCheck } from "./DecisionChecks.ts";
import {
  isScheduleActiveNow,
  selectActiveChargeSchedule,
} from "./Schedules.ts";
import type { ActiveChargeSchedule } from "./Schedules.ts";
import type {
  ControllerConfig,
  ControlStateUpdates,
  DebounceResult,
  EngineInput,
  EngineOutput,
  EngineSchedule,
  EngineVehicleInput,
  EvalResult,
  PipelineDecision,
  VehicleControlState,
  VehicleDecision,
} from "./types.ts";
import { createControlState } from "./types.ts";

/** Pure decision engine for the charge controller.
 *
 *  Owns per-vehicle runtime state (grace periods, cooldowns, amp debouncing)
 *  and exposes a single `decide()` method that takes the current state of the
 *  world and returns per-vehicle decisions.
 *
 *  No I/O, no database, no adapters. The caller (ChargeController or the
 *  simulator) executes the returned decisions. */
export class ControllerEngine {
  private controlStates = new Map<string, VehicleControlState>();

  /** Make decisions for all vehicles in a single loop iteration. */
  decide(input: EngineInput): EngineOutput {
    const { config, vehicles, schedules, energy, now, timestamp } = input;
    if (!config.chargingEnabled) {
      const decisions = new Map(
        vehicles.map((vehicle): [string, VehicleDecision] => [vehicle.id, {
          action: "none",
          reason: "charging_disabled",
          detail: "Charging disabled",
          targetAmps: null,
          checks: [],
        }]),
      );
      return { decisions, controlStates: this.controlStates };
    }

    // Pre-compute per-vehicle solar allocation
    const allocation = SolarAllocator.allocate(vehicles, config, energy);
    vehicles.forEach((vehicle) => {
      const cs = this.getControlState(vehicle.id);
      cs.allocatedAmps = allocation.get(vehicle.id) ?? null;
    });

    const decisions = new Map(
      vehicles.map((vehicle): [string, VehicleDecision] => [
        vehicle.id,
        this.decideVehicle(vehicle, config, schedules, energy, now, timestamp),
      ]),
    );

    return { decisions, controlStates: this.controlStates };
  }

  /** Read a vehicle's control state (for the orchestrator's event emission). */
  getControlState(vehicleId: string): VehicleControlState {
    const existing = this.controlStates.get(vehicleId);
    if (existing) return existing;
    const cs = createControlState();
    this.controlStates.set(vehicleId, cs);
    return cs;
  }

  // ---- Per-vehicle decision ----

  private decideVehicle(
    vehicle: EngineVehicleInput,
    config: ControllerConfig,
    schedules: EngineSchedule[],
    energy: EnergyData | null,
    now: Date,
    timestamp: number,
  ): VehicleDecision {
    const precondition = this.checkPreconditions(vehicle);
    if (precondition.decision) {
      return { ...precondition.decision, checks: precondition.checks };
    }

    if (!vehicle.state) {
      throw new Error(
        `Vehicle ${vehicle.id} passed preconditions without state`,
      );
    }
    const state = vehicle.state;
    const checks = [...precondition.checks, DecisionChecks.mode(vehicle.mode)];

    switch (vehicle.mode) {
      case "stop":
        return { ...this.decideStopMode(state), checks: [...checks] };

      case "charge_now":
        return { ...this.decideChargeNowMode(state), checks: [...checks] };

      case "auto":
        return this.decideAutoMode(
          vehicle,
          state,
          config,
          schedules,
          energy,
          now,
          timestamp,
          checks,
        );
    }
  }

  // ---- Preconditions ----

  private checkPreconditions(
    vehicle: EngineVehicleInput,
  ): EvalResult {
    const { state } = vehicle;
    const checks: DecisionCheck[] = [];

    if (!state) {
      checks.push(DecisionChecks.vehicleStateUnavailable());
      return {
        decision: {
          action: "none",
          reason: "no_state",
          detail: "No vehicle state available",
          targetAmps: null,
        },
        checks,
      };
    }

    checks.push(DecisionChecks.pluggedIn(state.isPluggedIn));
    // null (unknown) is treated as plugged in — only a definite false blocks.
    if (state.isPluggedIn === false) {
      return {
        decision: {
          action: "none",
          reason: "not_plugged_in",
          detail: "Not plugged in",
          targetAmps: null,
        },
        checks,
      };
    }

    checks.push(DecisionChecks.location(state.isHome));
    if (state.isHome === false) {
      return {
        decision: {
          action: "none",
          reason: "away_from_home",
          detail: "Away from home — automation suspended",
          targetAmps: null,
        },
        checks,
      };
    }

    const atLimit = state.batteryLevel >= state.chargeLimit;
    const atFullTarget = state.chargeLimit === 100 && state.batteryLevel >= 99;
    const nearLimitAndDone = !state.isCharging && atFullTarget;
    checks.push(DecisionChecks.batteryAtLimit(
      atLimit,
      nearLimitAndDone,
      state.batteryLevel,
      state.chargeLimit,
    ));

    if (atLimit) {
      return {
        decision: {
          action: state.isCharging ? "stop" : "none",
          reason: "battery_at_limit",
          detail: state.isCharging
            ? "Stop — battery at charge limit"
            : "Already stopped — battery at limit",
          targetAmps: null,
        },
        checks,
      };
    }

    if (nearLimitAndDone) {
      return {
        decision: {
          action: "none",
          reason: "battery_at_limit",
          detail:
            `Vehicle stopped at ${state.batteryLevel}% — within 1% of ${state.chargeLimit}% limit, not retrying`,
          targetAmps: null,
        },
        checks,
      };
    }

    return { decision: null, checks };
  }

  // ---- Mode handlers ----

  private decideStopMode(state: VehicleChargeState): PipelineDecision {
    return {
      action: state.isCharging ? "stop" : "none",
      reason: "mode_stop",
      detail: state.isCharging ? "Stop — mode set to stop" : "Already stopped",
      targetAmps: null,
    };
  }

  private decideChargeNowMode(state: VehicleChargeState): PipelineDecision {
    const amps = state.chargeAmpsMax;
    if (!state.isCharging) {
      return {
        action: "start",
        reason: "charge_now",
        detail: `Start charging at ${amps}A (charge_now)`,
        targetAmps: amps,
      };
    }
    if (state.chargeAmps !== amps) {
      return {
        action: "adjust_amps",
        reason: "charge_now",
        detail: `Adjust to ${amps}A (charge_now)`,
        targetAmps: amps,
      };
    }
    return {
      action: "none",
      reason: "charge_now",
      detail: `Already charging at ${amps}A (charge_now)`,
      targetAmps: amps,
    };
  }

  // ---- Auto mode pipeline ----

  private decideAutoMode(
    vehicle: EngineVehicleInput,
    state: VehicleChargeState,
    config: ControllerConfig,
    schedules: EngineSchedule[],
    energy: EnergyData | null,
    now: Date,
    timestamp: number,
    outerChecks: DecisionCheck[],
  ): VehicleDecision {
    const cs = this.getControlState(vehicle.id);
    const allChecks = [...outerChecks];

    const blockout = this.evaluateBlockout(
      state,
      config,
      schedules,
      now,
    );
    allChecks.push(...blockout.checks);
    if (blockout.decision) {
      if (blockout.stateUpdates) Object.assign(cs, blockout.stateUpdates);
      return { ...blockout.decision, checks: allChecks };
    }

    const schedule = this.evaluateSchedule(
      vehicle,
      state,
      config,
      schedules,
      now,
    );
    allChecks.push(...schedule.checks);
    if (schedule.decision) {
      return { ...schedule.decision, checks: allChecks };
    }
    const scheduleLimitContext = schedule.scheduleLimitContext;

    const battery = this.evaluateBatteryPriority(state, config, energy);
    allChecks.push(...battery.checks);
    if (battery.decision) {
      return { ...battery.decision, checks: allChecks, scheduleLimitContext };
    }

    const solar = this.evaluateSolarTracking(
      state,
      config,
      energy,
      timestamp,
      cs,
    );
    allChecks.push(...solar.checks);
    if (solar.decision) {
      if (solar.stateUpdates) Object.assign(cs, solar.stateUpdates);
      return { ...solar.decision, checks: allChecks, scheduleLimitContext };
    }

    const fallback = this.decideDefault(state);
    return { ...fallback, checks: allChecks, scheduleLimitContext };
  }

  // ---- Evaluation steps ----

  private evaluateBlockout(
    state: VehicleChargeState,
    config: ControllerConfig,
    schedules: EngineSchedule[],
    now: Date,
  ): EvalResult {
    const activeBlockout = schedules.find(
      (s) =>
        s.scheduleType === "blockout" && s.enabled &&
        isScheduleActiveNow(s, now, config.timezone),
    );
    const checks: DecisionCheck[] = [
      DecisionChecks.blockoutSchedule(activeBlockout ?? null),
    ];
    if (!activeBlockout) return { decision: null, checks };

    return {
      decision: {
        action: state.isCharging ? "stop" : "none",
        reason: "blockout",
        detail: state.isCharging
          ? `Stop — blockout schedule active (${activeBlockout.startTime}-${activeBlockout.endTime})`
          : "Blocked by blockout schedule",
        targetAmps: null,
        suspendable: !state.isCharging,
      },
      checks,
      // Track blockout charge notification state — the orchestrator reads
      // this flag to decide whether to emit the notification event
      stateUpdates: { blockoutChargeNotified: state.isCharging },
    };
  }

  private evaluateSchedule(
    vehicle: EngineVehicleInput,
    state: VehicleChargeState,
    config: ControllerConfig,
    schedules: EngineSchedule[],
    now: Date,
  ): EvalResult {
    const checks: DecisionCheck[] = [];
    const active = selectActiveChargeSchedule(
      schedules,
      vehicle,
      now,
      config.timezone,
    );
    if (!active) {
      checks.push(DecisionChecks.chargeScheduleNone());
      return { decision: null, checks };
    }
    const activeCharge = active.effective;

    const limitReached = activeCharge.chargeLimitPct !== null &&
      state.batteryLevel >= activeCharge.chargeLimitPct;
    checks.push(DecisionChecks.chargeSchedule(
      activeCharge,
      state.batteryLevel,
      limitReached,
    ));
    if (activeCharge.chargeLimitPct !== null && limitReached) {
      return {
        decision: null,
        checks,
        scheduleLimitContext: {
          scheduleLimitPct: activeCharge.chargeLimitPct,
          batteryLevel: state.batteryLevel,
        },
      };
    }

    const amps = activeCharge.chargeAmps ?? state.chargeAmpsMax;
    const merged = mergedSuffix(active);
    const makeDecision = (
      action: PipelineDecision["action"],
      detail: string,
    ): EvalResult => ({
      decision: { action, reason: "schedule", detail, targetAmps: amps },
      checks,
    });

    if (!state.isCharging) {
      return makeDecision(
        "start",
        `Start charging at ${amps}A (schedule ${activeCharge.startTime}-${activeCharge.endTime}${merged})`,
      );
    }
    if (state.chargeAmps !== amps) {
      return makeDecision(
        "adjust_amps",
        `Adjust to ${amps}A (schedule${merged})`,
      );
    }
    return makeDecision(
      "none",
      `Already charging at ${amps}A (schedule${merged})`,
    );
  }

  private evaluateBatteryPriority(
    state: VehicleChargeState,
    config: ControllerConfig,
    energy: EnergyData | null,
  ): EvalResult {
    const checks: DecisionCheck[] = [];
    if (!config.batteryPriorityEnabled || !energy) {
      checks.push(DecisionChecks.batteryPrioritySkip(
        config.batteryPriorityEnabled,
      ));
      return { decision: null, checks };
    }

    const belowLimit = energy.batterySoc !== null &&
      energy.batterySoc < config.batteryPriorityLimit;
    checks.push(DecisionChecks.batteryPriority(
      energy.batterySoc,
      config.batteryPriorityLimit,
      belowLimit,
    ));

    if (!belowLimit) return { decision: null, checks };

    return {
      decision: {
        action: state.isCharging ? "stop" : "none",
        reason: "battery_priority",
        detail: state.isCharging
          ? `Stop — battery priority (${energy.batterySoc}% < ${config.batteryPriorityLimit}%)`
          : `Waiting for home battery (${energy.batterySoc}% < ${config.batteryPriorityLimit}%)`,
        targetAmps: null,
      },
      checks,
    };
  }

  private evaluateSolarTracking(
    state: VehicleChargeState,
    config: ControllerConfig,
    energy: EnergyData | null,
    timestamp: number,
    controlState: Readonly<VehicleControlState>,
  ): EvalResult {
    const checks: DecisionCheck[] = [];
    if (!config.solarTrackingEnabled || !energy) {
      checks.push(DecisionChecks.solarTrackingSkip(
        config.solarTrackingEnabled,
      ));
      return { decision: null, checks };
    }

    const result = this.processSolarTracking(
      state,
      config,
      energy,
      timestamp,
      controlState,
    );
    return {
      decision: result.decision,
      checks: [...checks, ...result.checks],
      stateUpdates: result.stateUpdates,
    };
  }

  private decideDefault(state: VehicleChargeState): PipelineDecision {
    return {
      action: state.isCharging ? "stop" : "none",
      reason: "idle",
      detail: state.isCharging
        ? "Stop — no schedule or solar tracking"
        : "Idle — no schedule or solar tracking active",
      targetAmps: null,
      suspendable: !state.isCharging,
    };
  }

  // ---- Solar tracking ----

  private processSolarTracking(
    state: VehicleChargeState,
    config: ControllerConfig,
    energy: EnergyData,
    timestamp: number,
    controlState: Readonly<VehicleControlState>,
  ): EvalResult {
    const checks: DecisionCheck[] = [];

    const minSolar = this.checkMinSolarGeneration(state, config, energy);
    checks.push(...minSolar.checks);
    if (minSolar.decision) {
      return {
        decision: minSolar.decision,
        checks,
        stateUpdates: minSolar.stateUpdates,
      };
    }

    const minExcess = this.checkMinExcessSolar(state, config, energy);
    checks.push(...minExcess.checks);
    if (minExcess.decision) {
      return { decision: minExcess.decision, checks };
    }

    const voltage = SolarAllocator.resolveVoltage(
      state.chargerVoltage,
      energy,
      config.gridVoltage,
    );
    const phases = SolarAllocator.resolvePhases(state, config);

    const availableW = SolarAllocator.calculateAvailableSolar(
      config,
      energy,
      state,
      voltage,
      phases,
    );
    const targetAmps = controlState.allocatedAmps ??
      Math.floor(availableW / (voltage * phases));
    const clampedAmps = Math.max(
      state.chargeAmpsMin,
      Math.min(state.chargeAmpsMax, targetAmps),
    );

    checks.push(DecisionChecks.solarAvailable(
      availableW,
      targetAmps,
      state.chargeAmpsMin,
      state.chargeAmpsMax,
    ));

    // Production below the minimum generation threshold. Reaching here means
    // the vehicle is charging and production is above zero — checkMinSolarGeneration
    // handles every other case — so put the dip through the grace period
    // (drop to min amps, then stop) instead of charging on through it.
    const solarKw = energy.solarProductionW / 1000;
    const belowMinGeneration = solarKw < config.minSolarGenerationKw;

    if (belowMinGeneration || targetAmps < state.chargeAmpsMin) {
      const reason = belowMinGeneration
        ? belowMinGenerationReason(solarKw, config.minSolarGenerationKw)
        : insufficientSolarReason(availableW, targetAmps, state.chargeAmpsMin);
      const result = this.handleInsufficientSolar(
        state,
        controlState,
        config,
        timestamp,
        reason,
      );
      checks.push(...result.checks);
      return {
        decision: result.decision,
        checks,
        stateUpdates: result.stateUpdates,
      };
    }

    const result = this.handleSufficientSolar(
      state,
      controlState,
      config,
      timestamp,
      clampedAmps,
      availableW,
    );
    checks.push(...result.checks);
    return {
      decision: result.decision,
      checks,
      stateUpdates: result.stateUpdates,
    };
  }

  private handleSufficientSolar(
    state: VehicleChargeState,
    controlState: Readonly<VehicleControlState>,
    config: ControllerConfig,
    timestamp: number,
    clampedAmps: number,
    availableW: number,
  ): EvalResult {
    const checks: DecisionCheck[] = [];
    const stateUpdates: ControlStateUpdates = {
      graceStartedAt: null,
      graceNotified: false,
    };

    // Check cooldown: don't restart if recently stopped
    if (controlState.cooldownUntil && timestamp < controlState.cooldownUntil) {
      const remainingSec = Math.round(
        (controlState.cooldownUntil - timestamp) / 1000,
      );
      checks.push(DecisionChecks.cooldown(remainingSec));
      return {
        decision: {
          action: "none",
          reason: "cooldown",
          detail: `Cooldown active — ${remainingSec}s remaining`,
          targetAmps: null,
        },
        checks,
        stateUpdates,
      };
    }
    stateUpdates.cooldownUntil = null;

    const debounce = this.debounceAmps(
      state,
      controlState,
      config,
      clampedAmps,
      timestamp,
    );
    stateUpdates.pendingAmps = debounce.pendingAmps;
    stateUpdates.pendingSince = debounce.pendingSince;
    const debouncedAmps = debounce.amps;
    if (debouncedAmps !== clampedAmps) {
      checks.push(DecisionChecks.ampDebounce(debouncedAmps, clampedAmps));
    }

    if (!state.isCharging) {
      return {
        decision: {
          action: "start",
          reason: "solar_tracking",
          detail: `Start charging at ${debouncedAmps}A (solar tracking)`,
          targetAmps: debouncedAmps,
        },
        checks,
        stateUpdates,
      };
    }
    if (state.chargeAmps !== debouncedAmps) {
      return {
        decision: {
          action: "adjust_amps",
          reason: "solar_tracking",
          detail: `Adjust to ${debouncedAmps}A (solar: ${
            Math.round(availableW)
          }W)`,
          targetAmps: debouncedAmps,
        },
        checks,
        stateUpdates,
      };
    }
    return {
      decision: {
        action: "none",
        reason: "solar_tracking",
        detail: `Already charging at ${debouncedAmps}A (solar: ${
          Math.round(availableW)
        }W)`,
        targetAmps: debouncedAmps,
      },
      checks,
      stateUpdates,
    };
  }

  private handleInsufficientSolar(
    state: VehicleChargeState,
    controlState: Readonly<VehicleControlState>,
    config: ControllerConfig,
    timestamp: number,
    reason: string,
  ): EvalResult {
    const checks: DecisionCheck[] = [];
    const graceReset: ControlStateUpdates = {
      graceStartedAt: null,
      graceNotified: false,
    };

    if (!state.isCharging) {
      if (config.solarTrackingMode === "solar_grid") {
        return {
          decision: this.solarGridFallback(state, reason),
          checks,
          stateUpdates: graceReset,
        };
      }
      return {
        decision: {
          action: "none",
          reason: "solar_tracking",
          detail: `Not charging — ${reason}`,
          targetAmps: null,
        },
        checks,
        stateUpdates: graceReset,
      };
    }
    // Start grace period if not already started
    const graceStartedAt = controlState.graceStartedAt ?? timestamp;

    const graceMs = config.gracePeriodMinutes * 60 * 1000;
    const elapsed = timestamp - graceStartedAt;
    const elapsedSec = Math.round(elapsed / 1000);
    const graceSec = Math.round(graceMs / 1000);

    checks.push(DecisionChecks.gracePeriod(
      elapsed >= graceMs,
      elapsedSec,
      graceSec,
    ));

    if (elapsed >= graceMs) {
      if (config.solarTrackingMode === "solar_grid") {
        return {
          decision: this.solarGridFallback(state, reason),
          checks,
          stateUpdates: graceReset,
        };
      }

      // Solar Only: stop charging and start cooldown
      return {
        decision: {
          action: "stop",
          reason: "grace_period",
          detail: `Stop — ${reason}, grace period expired`,
          targetAmps: null,
        },
        checks,
        stateUpdates: {
          ...graceReset,
          cooldownUntil: timestamp +
            config.cooldownPeriodMinutes * 60 * 1000,
        },
      };
    }

    // Drop to minimum amps during grace period
    if (state.chargeAmps > state.chargeAmpsMin) {
      return {
        decision: {
          action: "adjust_amps",
          reason: "grace_period",
          detail:
            `Adjust to ${state.chargeAmpsMin}A (min) — grace period active (${elapsedSec}s/${graceSec}s) — ${reason}`,
          targetAmps: state.chargeAmpsMin,
        },
        checks,
        stateUpdates: { graceStartedAt },
      };
    }

    return {
      decision: {
        action: "none",
        reason: "grace_period",
        detail: `Grace period active (${elapsedSec}s/${graceSec}s) — ${reason}`,
        targetAmps: null,
      },
      checks,
      stateUpdates: { graceStartedAt },
    };
  }

  private solarGridFallback(
    state: VehicleChargeState,
    reason: string,
  ): PipelineDecision {
    const suffix =
      `at ${state.chargeAmpsMin}A from grid — ${reason} (solar+grid mode)`;
    if (state.isCharging && state.chargeAmps === state.chargeAmpsMin) {
      return {
        action: "none",
        reason: "solar_tracking",
        detail: `Charging ${suffix}`,
        targetAmps: state.chargeAmpsMin,
      };
    }
    if (state.isCharging) {
      return {
        action: "adjust_amps",
        reason: "solar_tracking",
        detail: `Charging ${suffix}`,
        targetAmps: state.chargeAmpsMin,
      };
    }
    return {
      action: "start",
      reason: "solar_tracking",
      detail: `Start charging ${suffix}`,
      targetAmps: state.chargeAmpsMin,
    };
  }

  // ---- Min solar/excess checks ----

  private checkMinSolarGeneration(
    state: VehicleChargeState,
    config: ControllerConfig,
    energy: EnergyData,
  ): EvalResult {
    const solarKw = energy.solarProductionW / 1000;
    const checks: DecisionCheck[] = [
      DecisionChecks.minSolarGeneration(solarKw, config.minSolarGenerationKw),
    ];

    if (solarKw >= config.minSolarGenerationKw) {
      return { decision: null, checks };
    }

    // Some solar exists but below threshold — if already charging, let the
    // normal tracking path handle it with grace period + cooldown instead of
    // stopping immediately. This prevents rapid stop/start cycling when solar
    // is fluctuating around the min generation threshold (e.g. sunrise ramp).
    if (energy.solarProductionW > 0 && state.isCharging) {
      return { decision: null, checks };
    }

    // Zero solar (nighttime) — stop immediately, no grace period.
    // Grace period is for riding out temporary dips, not nighttime.
    return {
      decision: {
        action: state.isCharging ? "stop" : "none",
        reason: "no_solar",
        detail: state.isCharging
          ? "Stop — no solar generation, no grace period"
          : "Not charging — below minimum solar generation",
        targetAmps: null,
        suspendable: !state.isCharging,
      },
      checks,
      stateUpdates: state.isCharging
        ? { graceStartedAt: null, graceNotified: false }
        : undefined,
    };
  }

  private checkMinExcessSolar(
    state: VehicleChargeState,
    config: ControllerConfig,
    energy: EnergyData,
  ): EvalResult {
    if (config.minExcessSolarKw === null) return { decision: null, checks: [] };

    const excessKw = this.calculateExcessKw(state, config, energy);
    const checks: DecisionCheck[] = [
      DecisionChecks.minExcessSolar(excessKw, config.minExcessSolarKw),
    ];

    if (excessKw >= config.minExcessSolarKw) return { decision: null, checks };

    // Already charging — let solar tracking handle it with grace period
    if (state.isCharging) return { decision: null, checks };

    return {
      decision: {
        action: "none",
        reason: "solar_tracking",
        detail: `Not charging — excess solar below minimum (${
          excessKw.toFixed(1)
        } kW < ${config.minExcessSolarKw} kW)`,
        targetAmps: null,
      },
      checks,
    };
  }

  private calculateExcessKw(
    state: VehicleChargeState,
    config: ControllerConfig,
    energy: EnergyData,
  ): number {
    // The early return for `consumptionExcludesCharging || !isCharging` is no
    // longer needed: SolarAllocator.addBackW returns 0 in exactly those cases,
    // and surplusW additionally nets off battery discharge and caps at panel
    // output — which the raw grid-export shortcut skipped.
    const voltage = SolarAllocator.resolveVoltage(
      state.chargerVoltage,
      energy,
      config.gridVoltage,
    );
    const phases = SolarAllocator.resolvePhases(state, config);
    const addBackW = SolarAllocator.addBackW(config, state, voltage, phases);
    return SolarAllocator.surplusW(energy, addBackW) / 1000;
  }

  // ---- Amp debouncing ----

  private debounceAmps(
    state: VehicleChargeState,
    controlState: Readonly<VehicleControlState>,
    config: ControllerConfig,
    targetAmps: number,
    timestamp: number,
  ): DebounceResult {
    const currentAmps = state.chargeAmps;

    // Starting from not charging — jump directly to target
    if (!state.isCharging) {
      return { amps: targetAmps, pendingAmps: null, pendingSince: null };
    }

    // No change needed
    if (targetAmps === currentAmps) {
      return { amps: targetAmps, pendingAmps: null, pendingSince: null };
    }

    // Large change — apply immediately
    if (Math.abs(targetAmps - currentAmps) > config.ampDebounceThreshold) {
      return { amps: targetAmps, pendingAmps: null, pendingSince: null };
    }

    // Small change — debounce until target is stable
    if (controlState.pendingAmps !== targetAmps) {
      return {
        amps: currentAmps,
        pendingAmps: targetAmps,
        pendingSince: timestamp,
      };
    }

    // Target has been stable — check if long enough
    const settleMs = config.ampDebounceSettleMinutes * 60_000;
    const elapsed = timestamp - (controlState.pendingSince ?? timestamp);
    if (elapsed >= settleMs) {
      return { amps: targetAmps, pendingAmps: null, pendingSince: null };
    }

    return {
      amps: currentAmps,
      pendingAmps: controlState.pendingAmps,
      pendingSince: controlState.pendingSince,
    };
  }
}

/** Suffix appended to a schedule decision's detail when two or more
 *  overlapping schedules were merged. Empty for the ordinary single-schedule
 *  case so existing log text is unchanged. */
function mergedSuffix(active: ActiveChargeSchedule): string {
  if (!active.merged) return "";
  const pct = active.effective.chargeLimitPct;
  if (pct === null) return " merged";
  return ` merged, limit ${pct}%`;
}

/** Reason text when solar production is under the configured minimum. */
function belowMinGenerationReason(solarKw: number, minKw: number): string {
  return `solar generation below minimum (${
    solarKw.toFixed(2)
  } kW < ${minKw} kW)`;
}

/** Reason text when available solar can't sustain the vehicle's minimum amps. */
function insufficientSolarReason(
  availableW: number,
  targetAmps: number,
  minAmps: number,
): string {
  return `insufficient solar (${
    Math.round(availableW)
  }W → ${targetAmps}A < min ${minAmps}A)`;
}
