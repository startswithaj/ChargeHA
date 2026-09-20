import type { DayOfWeek } from "@chargeha/shared";
import type { SystemAlert } from "./types.ts";
import type { StepTrace } from "@chargeha/shared/engine";
import type { DecisionInputs } from "./types.ts";

export function parseDecisionInputs(json: string): DecisionInputs | null {
  try {
    return JSON.parse(json) as DecisionInputs;
  } catch {
    return null;
  }
}

export function parseStepTrace(json: string): StepTrace[] {
  try {
    return JSON.parse(json) as StepTrace[];
  } catch {
    return [];
  }
}

export function parseSystemAlert(json: string): SystemAlert | null {
  try {
    return JSON.parse(json) as SystemAlert;
  } catch {
    return null;
  }
}

export function parseDays(json: string): DayOfWeek[] {
  try {
    return JSON.parse(json) as DayOfWeek[];
  } catch {
    return [];
  }
}
