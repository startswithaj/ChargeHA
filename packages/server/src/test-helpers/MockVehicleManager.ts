import type { VehicleChargeState } from "@chargeha/shared";

export class MockVehicleManager {
  private states = new Map<string, VehicleChargeState>();
  private errors = new Map<string, Error>();

  addState(id: string, state: VehicleChargeState): void {
    this.states.set(id, state);
  }

  setVehicleError(id: string, error: Error): void {
    this.errors.set(id, error);
  }

  getAllStates(): Map<string, VehicleChargeState> {
    return new Map(this.states);
  }

  getVehicleIds(): string[] {
    return Array.from(this.states.keys());
  }

  getVehicleError(id: string): Error | undefined {
    return this.errors.get(id);
  }
}
