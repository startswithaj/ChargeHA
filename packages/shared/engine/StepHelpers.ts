import type { VehicleChargeState } from "../types.ts";
import type { ActiveChargeSchedule } from "./Schedules.ts";
import type { SolarTargets } from "./SolarAllocator.ts";
import type {
  ControllerConfig,
  DebounceResult,
  PipelineDecision,
  VehicleControlState,
} from "./types.ts";

// Shared by the steps. Kept out of Steps so that class holds only steps.
export class StepHelpers {
  // Start / adjust / no-op depending on whether the vehicle is already
  // charging at `amps`.
  static chargeAt(
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

  static solarGridFallback(
    state: VehicleChargeState,
    reason: string,
  ): PipelineDecision {
    const suffix =
      `at ${state.chargeAmpsMin}A from grid — ${reason} (solar+grid mode)`;
    return StepHelpers.chargeAt(state, state.chargeAmpsMin, "solar_tracking", {
      start: `Start charging ${suffix}`,
      adjust: `Charging ${suffix}`,
      none: `Charging ${suffix}`,
    });
  }

  static debounceAmps(
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
  static mergedSuffix(active: ActiveChargeSchedule): string {
    if (!active.merged) return "";
    const pct = active.effective.chargeLimitPct;
    if (pct === null) return " merged";
    return ` merged, limit ${pct}%`;
  }

  static insufficientReason(
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
