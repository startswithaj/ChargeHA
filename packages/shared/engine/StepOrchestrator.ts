import { Steps } from "./Steps.ts";
import type { Step, StepContext } from "./Steps.ts";
import type { StepTrace } from "./Trace.ts";
import type { ControlStateUpdates, VehicleDecision } from "./types.ts";

// Final decision plus the control-state changes the engine applies.
export interface StepRunResult {
  decision: VehicleDecision;
  stateUpdates: ControlStateUpdates;
}

export class StepOrchestrator {
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
    return StepOrchestrator.runFrom(ctx, 0, []);
  }

  private static runFrom(
    ctx: StepContext,
    index: number,
    collected: StepTrace[],
  ): StepRunResult {
    const step = StepOrchestrator.ORDER[index];
    if (!step) throw new Error("Step pipeline ended without a decision");
    const result = step(ctx);
    const checks = [...collected, ...result.trace];
    if (!result.decision) {
      return StepOrchestrator.runFrom(ctx, index + 1, checks);
    }
    return {
      decision: { ...result.decision, checks },
      stateUpdates: result.stateUpdates ?? {},
    };
  }
}
