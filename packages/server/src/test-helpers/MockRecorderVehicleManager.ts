import type { VehicleChargeState } from "@chargeha/shared";

// Used by DataRecorder tests. Distinct from MockVehicleManager (subscriptions
// router) which exposes a richer API with errors and per-vehicle lookups.
export class MockRecorderVehicleManager {
  private states = new Map<string, VehicleChargeState>();

  setVehicleState(id: string, state: VehicleChargeState): void {
    this.states.set(id, state);
  }

  getAllStates(): Map<string, VehicleChargeState> {
    return new Map(this.states);
  }

  getState(id: string): Promise<VehicleChargeState | null> {
    return Promise.resolve(this.states.get(id) ?? null);
  }
}
