import type { VehicleChargeState } from "../types.ts";

export function atChargeLimit(state: VehicleChargeState): boolean {
  return state.batteryLevel >= state.chargeLimit;
}

export function stoppedNearFullLimit(state: VehicleChargeState): boolean {
  return !state.isCharging && state.chargeLimit === 100 &&
    state.batteryLevel >= 99;
}

export function chargeFinished(state: VehicleChargeState): boolean {
  return atChargeLimit(state) || stoppedNearFullLimit(state);
}
