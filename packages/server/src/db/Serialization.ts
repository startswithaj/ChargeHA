import type { DayOfWeek } from "@chargeha/shared";
import type { SystemAlert } from "./types.ts";
import type { DecisionCheck } from "@chargeha/shared/engine";
import type { DecisionInputs } from "../services/ChargeController.ts";

/** Parse a JSON string into DecisionInputs, returning null on failure. */
export function parseDecisionInputs(json: string): DecisionInputs | null {
  try {
    return JSON.parse(json) as DecisionInputs;
  } catch {
    return null;
  }
}

/** Parse a JSON string into DecisionCheck[], returning [] on failure. */
export function parseDecisionChecks(json: string): DecisionCheck[] {
  try {
    return JSON.parse(json) as DecisionCheck[];
  } catch {
    return [];
  }
}

/** Parse a JSON string into SystemAlert, returning null on failure. */
export function parseSystemAlert(json: string): SystemAlert | null {
  try {
    return JSON.parse(json) as SystemAlert;
  } catch {
    return null;
  }
}

/** Parse a JSON string into DayOfWeek[], returning [] on failure. */
export function parseDays(json: string): DayOfWeek[] {
  try {
    return JSON.parse(json) as DayOfWeek[];
  } catch {
    return [];
  }
}
