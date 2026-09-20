import type { EnergyData, VehicleChargeState } from "../types.ts";
import { SolarAllocator } from "./SolarAllocator.ts";
import { Trace } from "./Trace.ts";
import type { StepTrace } from "./Trace.ts";
import {
  isScheduleActiveNow,
  selectActiveChargeSchedule,
} from "./Schedules.ts";
import type { ActiveChargeSchedule } from "./Schedules.ts";
import type {
  ControllerConfig,
  ControlStateUpdates,
  DebounceResult,
  EngineSchedule,
  EngineVehicleInput,
  EvalResult,
  PipelineDecision,
  VehicleControlState,
  VehicleDecision,
} from "./types.ts";

// Solar numbers shared by every solar step. Null when solar tracking is
// disabled or there is no energy data.
export interface SolarTargets {
  voltage: number;
  phases: number;
  solarKw: number;
  availableW: number;
  targetAmps: number;
  clampedAmps: number;
  belowMinGeneration: boolean;
  belowMinAmps: boolean;
}

// Everything a step may read. Built once per vehicle per loop; steps never
// mutate it — control state changes come back as `stateUpdates`.
export interface StepContext {
  vehicle: EngineVehicleInput;
  state: VehicleChargeState;
  config: ControllerConfig;
  schedules: EngineSchedule[];
  energy: EnergyData | null;
  now: Date;
  timestamp: number;
  cs: Readonly<VehicleControlState>;
  solar: SolarTargets | null;
}

export type Step = (ctx: StepContext) => EvalResult;

// What the runner collects across steps until one decides.
interface Collected {
  checks: StepTrace[];
  stateUpdates: ControlStateUpdates;
  scheduleLimitContext?: VehicleDecision["scheduleLimitContext"];
}

// Final decision plus the control-state changes the engine applies.
export interface StepRunResult {
  decision: VehicleDecision;
  stateUpdates: ControlStateUpdates;
}

const pass = (trace: StepTrace[] = []): EvalResult => ({
  decision: null,
  trace,
});

const graceReset = (): ControlStateUpdates => ({
  graceStartedAt: null,
  graceNotified: false,
});

export class Steps {
  // Evaluated in order. The first step to return a decision ends the run.
  static readonly ORDER: readonly Step[] = [
    Steps.pluggedIn,
    Steps.atHome,
    Steps.batteryAtLimit,
    Steps.mode,
    Steps.blockout,
    Steps.chargeSchedule,
    Steps.batteryPriority,
    Steps.solarTrackingGate,
    Steps.minSolarGeneration,
    Steps.minExcessSolar,
    Steps.insufficientSolar,
    Steps.cooldown,
    Steps.sufficientSolar,
    Steps.idle,
  ];

  static run(ctx: StepContext): StepRunResult {
    return Steps.runFrom(ctx, 0, {
      checks: [],
      stateUpdates: {},
      scheduleLimitContext: undefined,
    });
  }

  private static runFrom(
    ctx: StepContext,
    index: number,
    acc: Collected,
  ): StepRunResult {
    const step = Steps.ORDER[index];
    if (!step) throw new Error("Step pipeline ended without a decision");
    const result = step(ctx);
    const next: Collected = {
      checks: [...acc.checks, ...result.trace],
      stateUpdates: { ...acc.stateUpdates, ...result.stateUpdates },
      scheduleLimitContext: acc.scheduleLimitContext ??
        result.scheduleLimitContext,
    };
    if (!result.decision) return Steps.runFrom(ctx, index + 1, next);
    return {
      decision: {
        ...result.decision,
        checks: next.checks,
        scheduleLimitContext: next.scheduleLimitContext,
      },
      stateUpdates: next.stateUpdates,
    };
  }

  static solarTargets(
    state: VehicleChargeState,
    config: ControllerConfig,
    energy: EnergyData | null,
    allocatedAmps: number | null,
  ): SolarTargets | null {
    if (!config.solarTrackingEnabled || !energy) return null;
    const voltage = SolarAllocator.resolveVoltage(
      state.chargerVoltage,
      energy,
      config.gridVoltage,
    );
    const phases = SolarAllocator.resolvePhases(state.chargerPhases, config);
    const availableW = SolarAllocator.calculateAvailableSolar(
      config,
      energy,
      state,
      voltage,
      phases,
    );
    const targetAmps = allocatedAmps ??
      Math.floor(availableW / (voltage * phases));
    const clampedAmps = Math.max(
      state.chargeAmpsMin,
      Math.min(state.chargeAmpsMax, targetAmps),
    );
    const solarKw = energy.solarProductionW / 1000;
    return {
      voltage,
      phases,
      solarKw,
      availableW,
      targetAmps,
      clampedAmps,
      belowMinGeneration: solarKw < config.minSolarGenerationKw,
      belowMinAmps: targetAmps < state.chargeAmpsMin,
    };
  }

  // ---- Preconditions ----

  static pluggedIn({ state }: StepContext): EvalResult {
    if (state.isPluggedIn === true) return pass([Trace.pluggedIn()]);
    // null (unknown) is treated as plugged in — only a definite false blocks.
    if (state.isPluggedIn === null) return pass([Trace.pluggedInUnknown()]);
    return {
      decision: {
        action: "none",
        reason: "not_plugged_in",
        detail: "Not plugged in",
        targetAmps: null,
      },
      trace: [Trace.unplugged()],
    };
  }

  static atHome({ state }: StepContext): EvalResult {
    if (state.isHome === true) return pass([Trace.home()]);
    if (state.isHome === null) return pass([Trace.locationUnknown()]);
    return {
      decision: {
        action: "none",
        reason: "away_from_home",
        detail: "Away from home — automation suspended",
        targetAmps: null,
      },
      trace: [Trace.away()],
    };
  }

  static batteryAtLimit({ state }: StepContext): EvalResult {
    const { batteryLevel, chargeLimit } = state;
    if (batteryLevel >= chargeLimit) {
      return {
        decision: {
          action: state.isCharging ? "stop" : "none",
          reason: "battery_at_limit",
          detail: state.isCharging
            ? "Stop — battery at charge limit"
            : "Already stopped — battery at limit",
          targetAmps: null,
        },
        trace: [Trace.batteryAtLimit(batteryLevel, chargeLimit)],
      };
    }
    const nearLimitAndDone = !state.isCharging && chargeLimit === 100 &&
      batteryLevel >= 99;
    if (nearLimitAndDone) {
      return {
        decision: {
          action: "none",
          reason: "battery_at_limit",
          detail:
            `Vehicle stopped at ${batteryLevel}% — within 1% of ${chargeLimit}% limit, not retrying`,
          targetAmps: null,
        },
        trace: [Trace.batteryNearLimit(batteryLevel, chargeLimit)],
      };
    }
    return pass([Trace.batteryBelowLimit(batteryLevel, chargeLimit)]);
  }

  // ---- Mode ----

  static mode({ vehicle, state }: StepContext): EvalResult {
    const trace = [Trace.mode(vehicle.mode)];
    switch (vehicle.mode) {
      case "auto":
        return pass(trace);
      case "stop":
        return {
          decision: {
            action: state.isCharging ? "stop" : "none",
            reason: "mode_stop",
            detail: state.isCharging
              ? "Stop — mode set to stop"
              : "Already stopped",
            targetAmps: null,
          },
          trace,
        };
      case "charge_now": {
        const amps = state.chargeAmpsMax;
        return {
          decision: Steps.chargeAt(state, amps, "charge_now", {
            start: `Start charging at ${amps}A (charge_now)`,
            adjust: `Adjust to ${amps}A (charge_now)`,
            none: `Already charging at ${amps}A (charge_now)`,
          }),
          trace,
        };
      }
    }
  }

  // ---- Schedules ----

  static blockout({ state, config, schedules, now }: StepContext): EvalResult {
    const active = schedules.find(
      (s) =>
        s.scheduleType === "blockout" && s.enabled &&
        isScheduleActiveNow(s, now, config.timezone),
    );
    if (!active) return pass([Trace.blockoutNone()]);
    return {
      decision: {
        action: state.isCharging ? "stop" : "none",
        reason: "blockout",
        detail: state.isCharging
          ? `Stop — blockout schedule active (${active.startTime}-${active.endTime})`
          : "Blocked by blockout schedule",
        targetAmps: null,
        suspendable: !state.isCharging,
      },
      trace: [Trace.blockoutActive(active)],
      // The orchestrator reads this flag to decide whether to emit the
      // blockout charge notification event
      stateUpdates: { blockoutChargeNotified: state.isCharging },
    };
  }

  static chargeSchedule(
    { vehicle, state, config, schedules, now }: StepContext,
  ): EvalResult {
    const active = selectActiveChargeSchedule(
      schedules,
      vehicle,
      now,
      config.timezone,
    );
    if (!active) return pass([Trace.scheduleNone()]);
    const effective = active.effective;

    if (
      effective.chargeLimitPct !== null &&
      state.batteryLevel >= effective.chargeLimitPct
    ) {
      return {
        decision: null,
        trace: [Trace.scheduleLimitReached(effective, state.batteryLevel)],
        scheduleLimitContext: {
          scheduleLimitPct: effective.chargeLimitPct,
          batteryLevel: state.batteryLevel,
        },
      };
    }

    const amps = effective.chargeAmps ?? state.chargeAmpsMax;
    const merged = Steps.mergedSuffix(active);
    return {
      decision: Steps.chargeAt(state, amps, "schedule", {
        start:
          `Start charging at ${amps}A (schedule ${effective.startTime}-${effective.endTime}${merged})`,
        adjust: `Adjust to ${amps}A (schedule${merged})`,
        none: `Already charging at ${amps}A (schedule${merged})`,
      }),
      trace: [Trace.scheduleActive(effective)],
    };
  }

  // ---- Home battery ----

  static batteryPriority({ state, config, energy }: StepContext): EvalResult {
    if (!config.batteryPriorityEnabled) {
      return pass([Trace.batteryPriorityDisabled()]);
    }
    if (!energy) return pass([Trace.batteryPriorityNoEnergy()]);
    const soc = energy.batterySoc;
    const limit = config.batteryPriorityLimit;
    if (soc === null) return pass([Trace.batteryPriorityNoData()]);
    if (soc >= limit) return pass([Trace.batteryPriorityOk(soc, limit)]);
    return {
      decision: {
        action: state.isCharging ? "stop" : "none",
        reason: "battery_priority",
        detail: state.isCharging
          ? `Stop — battery priority (${soc}% < ${limit}%)`
          : `Waiting for home battery (${soc}% < ${limit}%)`,
        targetAmps: null,
      },
      trace: [Trace.batteryPriorityHold(soc, limit)],
    };
  }

  // ---- Solar tracking ----

  static solarTrackingGate({ config, solar }: StepContext): EvalResult {
    if (solar) return pass();
    if (!config.solarTrackingEnabled) {
      return pass([Trace.solarTrackingDisabled()]);
    }
    return pass([Trace.solarTrackingNoEnergy()]);
  }

  static minSolarGeneration(
    { state, config, energy, solar }: StepContext,
  ): EvalResult {
    if (!solar || !energy) return pass();
    const minKw = config.minSolarGenerationKw;
    if (!solar.belowMinGeneration) {
      return pass([Trace.minSolarOk(solar.solarKw, minKw)]);
    }
    const trace = [Trace.minSolarBelow(solar.solarKw, minKw)];

    // Some solar exists but below threshold — if already charging, let the
    // normal tracking path handle it with grace period + cooldown instead of
    // stopping immediately. This prevents rapid stop/start cycling when solar
    // is fluctuating around the min generation threshold (e.g. sunrise ramp).
    if (energy.solarProductionW > 0 && state.isCharging) return pass(trace);

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
      trace,
      stateUpdates: state.isCharging ? graceReset() : undefined,
    };
  }

  static minExcessSolar(
    { state, config, energy, solar }: StepContext,
  ): EvalResult {
    if (!solar || !energy || config.minExcessSolarKw === null) return pass();
    const thresholdKw = config.minExcessSolarKw;

    // No early return for `consumptionExcludesCharging || !isCharging`:
    // addBackW is already 0 in those cases, and surplusW additionally nets off
    // battery discharge and caps at panel output.
    const addBackW = SolarAllocator.addBackW(
      config,
      state,
      solar.voltage,
      solar.phases,
    );
    const excessKw = SolarAllocator.surplusW(energy, addBackW) / 1000;
    if (excessKw >= thresholdKw) {
      return pass([Trace.minExcessOk(excessKw, thresholdKw)]);
    }
    const trace = [Trace.minExcessBelow(excessKw, thresholdKw)];
    // Already charging — let solar tracking handle it with grace period
    if (state.isCharging) return pass(trace);
    return {
      decision: {
        action: "none",
        reason: "solar_tracking",
        detail: `Not charging — excess solar below minimum (${
          excessKw.toFixed(1)
        } kW < ${thresholdKw} kW)`,
        targetAmps: null,
      },
      trace,
    };
  }

  static insufficientSolar(
    { state, config, timestamp, cs, solar }: StepContext,
  ): EvalResult {
    if (!solar) return pass();
    const trace = [Trace.solarAvailable(
      solar.availableW,
      solar.targetAmps,
      state.chargeAmpsMin,
      state.chargeAmpsMax,
    )];

    // Production below the minimum generation threshold. Reaching here means
    // the vehicle is charging and production is above zero — minSolarGeneration
    // handles every other case — so put the dip through the grace period
    // (drop to min amps, then stop) instead of charging on through it.
    if (!solar.belowMinGeneration && !solar.belowMinAmps) return pass(trace);
    const reason = Steps.insufficientReason(solar, state, config);

    if (!state.isCharging) {
      if (config.solarTrackingMode === "solar_grid") {
        return {
          decision: Steps.solarGridFallback(state, reason),
          trace,
          stateUpdates: graceReset(),
        };
      }
      return {
        decision: {
          action: "none",
          reason: "solar_tracking",
          detail: `Not charging — ${reason}`,
          targetAmps: null,
        },
        trace,
        stateUpdates: graceReset(),
      };
    }

    // Start grace period if not already started
    const graceStartedAt = cs.graceStartedAt ?? timestamp;
    const graceMs = config.gracePeriodMinutes * 60 * 1000;
    const elapsed = timestamp - graceStartedAt;
    const elapsedSec = Math.round(elapsed / 1000);
    const graceSec = Math.round(graceMs / 1000);

    if (elapsed >= graceMs) {
      trace.push(Trace.graceExpired(elapsedSec, graceSec));
      if (config.solarTrackingMode === "solar_grid") {
        return {
          decision: Steps.solarGridFallback(state, reason),
          trace,
          stateUpdates: graceReset(),
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
        trace,
        stateUpdates: {
          ...graceReset(),
          cooldownUntil: timestamp + config.cooldownPeriodMinutes * 60 * 1000,
        },
      };
    }

    trace.push(Trace.graceActive(elapsedSec, graceSec));
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
        trace,
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
      trace,
      stateUpdates: { graceStartedAt },
    };
  }

  // Don't restart if recently stopped
  static cooldown({ timestamp, cs, solar }: StepContext): EvalResult {
    if (!solar) return pass();
    if (!cs.cooldownUntil || timestamp >= cs.cooldownUntil) return pass();
    const remainingSec = Math.round((cs.cooldownUntil - timestamp) / 1000);
    return {
      decision: {
        action: "none",
        reason: "cooldown",
        detail: `Cooldown active — ${remainingSec}s remaining`,
        targetAmps: null,
      },
      trace: [Trace.cooldown(remainingSec)],
      stateUpdates: graceReset(),
    };
  }

  static sufficientSolar(
    { state, config, timestamp, cs, solar }: StepContext,
  ): EvalResult {
    if (!solar) return pass();
    const debounce = Steps.debounceAmps(
      state,
      cs,
      config,
      solar.clampedAmps,
      timestamp,
    );
    const amps = debounce.amps;
    const trace = amps !== solar.clampedAmps
      ? [Trace.ampDebounce(amps, solar.clampedAmps)]
      : [];
    const solarW = Math.round(solar.availableW);
    return {
      decision: Steps.chargeAt(state, amps, "solar_tracking", {
        start: `Start charging at ${amps}A (solar tracking)`,
        adjust: `Adjust to ${amps}A (solar: ${solarW}W)`,
        none: `Already charging at ${amps}A (solar: ${solarW}W)`,
      }),
      trace,
      stateUpdates: {
        ...graceReset(),
        cooldownUntil: null,
        pendingAmps: debounce.pendingAmps,
        pendingSince: debounce.pendingSince,
      },
    };
  }

  // ---- Fallback ----

  static idle({ state }: StepContext): EvalResult {
    return {
      decision: {
        action: state.isCharging ? "stop" : "none",
        reason: "idle",
        detail: state.isCharging
          ? "Stop — no schedule or solar tracking"
          : "Idle — no schedule or solar tracking active",
        targetAmps: null,
        suspendable: !state.isCharging,
      },
      trace: [],
    };
  }

  // Start / adjust / no-op depending on whether the vehicle is already
  // charging at `amps`.
  private static chargeAt(
    state: VehicleChargeState,
    amps: number,
    reason: PipelineDecision["reason"],
    detail: { start: string; adjust: string; none: string },
  ): PipelineDecision {
    if (!state.isCharging) {
      return {
        action: "start",
        reason,
        detail: detail.start,
        targetAmps: amps,
      };
    }
    if (state.chargeAmps !== amps) {
      return {
        action: "adjust_amps",
        reason,
        detail: detail.adjust,
        targetAmps: amps,
      };
    }
    return { action: "none", reason, detail: detail.none, targetAmps: amps };
  }

  private static solarGridFallback(
    state: VehicleChargeState,
    reason: string,
  ): PipelineDecision {
    const suffix =
      `at ${state.chargeAmpsMin}A from grid — ${reason} (solar+grid mode)`;
    return Steps.chargeAt(state, state.chargeAmpsMin, "solar_tracking", {
      start: `Start charging ${suffix}`,
      adjust: `Charging ${suffix}`,
      none: `Charging ${suffix}`,
    });
  }

  private static debounceAmps(
    state: VehicleChargeState,
    cs: Readonly<VehicleControlState>,
    config: ControllerConfig,
    targetAmps: number,
    timestamp: number,
  ): DebounceResult {
    const currentAmps = state.chargeAmps;
    const immediate = {
      amps: targetAmps,
      pendingAmps: null,
      pendingSince: null,
    };

    // Starting from not charging — jump directly to target
    if (!state.isCharging) return immediate;
    // No change needed
    if (targetAmps === currentAmps) return immediate;
    // Large change — apply immediately
    if (Math.abs(targetAmps - currentAmps) > config.ampDebounceThreshold) {
      return immediate;
    }
    // Small change — debounce until target is stable
    if (cs.pendingAmps !== targetAmps) {
      return {
        amps: currentAmps,
        pendingAmps: targetAmps,
        pendingSince: timestamp,
      };
    }
    // Target has been stable — check if long enough
    const settleMs = config.ampDebounceSettleMinutes * 60_000;
    const elapsed = timestamp - (cs.pendingSince ?? timestamp);
    if (elapsed >= settleMs) return immediate;
    return {
      amps: currentAmps,
      pendingAmps: cs.pendingAmps,
      pendingSince: cs.pendingSince,
    };
  }

  // Suffix appended to a schedule decision's detail when two or more
  // overlapping schedules were merged. Empty for the ordinary single-schedule case so existing log text is unchanged.
  private static mergedSuffix(active: ActiveChargeSchedule): string {
    if (!active.merged) return "";
    const pct = active.effective.chargeLimitPct;
    if (pct === null) return " merged";
    return ` merged, limit ${pct}%`;
  }

  private static insufficientReason(
    solar: SolarTargets,
    state: VehicleChargeState,
    config: ControllerConfig,
  ): string {
    if (solar.belowMinGeneration) {
      return `solar generation below minimum (${
        solar.solarKw.toFixed(2)
      } kW < ${config.minSolarGenerationKw} kW)`;
    }
    return `insufficient solar (${
      Math.round(solar.availableW)
    }W → ${solar.targetAmps}A < min ${state.chargeAmpsMin}A)`;
  }
}
