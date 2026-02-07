import type { EnergyData } from "@chargeha/shared";

/**
 * Adapter used by EnergyPoller tests. Differs from MockEnergyAdapter:
 * exposes a `shouldFail` toggle and the EM-shaped lifecycle stubs the poller
 * needs to subscribe to `config_changed`.
 */
export class MockEnergyPollerAdapter {
  shouldFail = false;

  constructor(private realtime: EnergyData) {}

  pollIntervalSeconds(): number {
    return 5;
  }

  getRealtimeData(): Promise<EnergyData> {
    if (this.shouldFail) throw new Error("Adapter error");
    return Promise.resolve({ ...this.realtime });
  }

  // EM-shaped stubs: poller subscribes to config_changed and calls these
  // when a relevant key fires — tests never emit that event, so these are
  // inert but need to satisfy the type.
  isRelevantConfigKey(): boolean {
    return false;
  }
  reconfigure(): Promise<void> {
    return Promise.resolve();
  }
  ready(): Promise<void> {
    return Promise.resolve();
  }
}
