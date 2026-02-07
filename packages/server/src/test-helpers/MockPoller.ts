import type { CumulativeEnergyData, EnergyData } from "@chargeha/shared";
import { ServiceError } from "../lib/ServiceError.ts";

export class MockPoller {
  private snapshot:
    | { realtime: EnergyData; cumulative: CumulativeEnergyData }
    | null = null;

  setSnapshot(realtime: EnergyData, cumulative: CumulativeEnergyData): void {
    this.snapshot = { realtime, cumulative };
  }

  getRealtimeSnapshot() {
    if (!this.snapshot) {
      throw new ServiceError("No data available yet", "PRECONDITION_FAILED");
    }
    return { timestamp: new Date().toISOString(), ...this.snapshot };
  }

  tryGetRealtimeSnapshot() {
    if (!this.snapshot) return null;
    return { timestamp: new Date().toISOString(), ...this.snapshot };
  }

  restart() {}
}
