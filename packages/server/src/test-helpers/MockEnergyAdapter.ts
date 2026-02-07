import type {
  CumulativeEnergyData,
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";

/**
 * Used by EnergyAdapterManager tests. Returns fixed data from the values
 * passed to the constructor (or empty defaults).
 *
 * EnergyPoller tests use a different shape — see MockEnergyPollerAdapter.
 */
export class MockEnergyAdapter implements EnergySourceAdapter {
  connectCalled = false;
  disconnectCalled = false;

  constructor(
    private realtime: EnergyData,
    private cumulative: CumulativeEnergyData,
    private deviceInfo: DeviceInfo,
  ) {}

  pollIntervalSeconds(): number {
    return 5;
  }

  connect(): Promise<void> {
    this.connectCalled = true;
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.disconnectCalled = true;
    return Promise.resolve();
  }

  getRealtimeData(): Promise<EnergyData> {
    return Promise.resolve({ ...this.realtime });
  }

  getCumulativeData(): Promise<CumulativeEnergyData> {
    return Promise.resolve({ ...this.cumulative });
  }

  getDeviceInfo(): Promise<DeviceInfo> {
    return Promise.resolve({ ...this.deviceInfo });
  }
}
