import type { EnergyData } from "@chargeha/shared";
import type { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import { throwingMock } from "./throwingMock.ts";

/** Immediate reads for unit tests; deferred reads/lifecycle gates for race tests. */
export class MockEnergyPollerAdapter {
  shouldFail = false;
  deferred = false;
  intervalSeconds = 10;
  readyGate: Promise<void> = Promise.resolve();
  reconfigureGate: Promise<void> = Promise.resolve();
  readonly readyEntered = Promise.withResolvers<void>();
  readonly reconfigureEntered = Promise.withResolvers<void>();
  readonly reads: {
    signal?: AbortSignal;
    resolve: (data: EnergyData) => void;
    reject: (error: Error) => void;
  }[] = [];
  readonly reconfigurations: number[] = [];
  private readEntered = Promise.withResolvers<void>();

  constructor(private realtime: EnergyData) {}

  asManager(): EnergyAdapterManager {
    return throwingMock<EnergyAdapterManager>("EnergyAdapterManager", {
      activePluginId: null,
      ready: () => this.ready(),
      reconfigure: () => this.reconfigure(),
      isRelevantConfigKey: () => this.isRelevantConfigKey(),
      pollIntervalSeconds: () => this.pollIntervalSeconds(),
      getRealtimeData: (_load, signal) => this.getRealtimeData(signal),
    });
  }

  pollIntervalSeconds(): number {
    return this.intervalSeconds;
  }

  async waitForRead(count: number): Promise<void> {
    if (this.reads.length >= count) return;
    await this.readEntered.promise;
    return this.waitForRead(count);
  }

  getRealtimeData(signal?: AbortSignal): Promise<EnergyData> {
    if (this.shouldFail) throw new Error("Adapter error");
    if (!this.deferred) return Promise.resolve({ ...this.realtime });
    const read = Promise.withResolvers<EnergyData>();
    this.reads.push({ signal, resolve: read.resolve, reject: read.reject });
    const entered = this.readEntered;
    this.readEntered = Promise.withResolvers<void>();
    entered.resolve();
    return read.promise;
  }

  isRelevantConfigKey(): boolean {
    return this.deferred;
  }
  reconfigure(): Promise<void> {
    this.reconfigurations.push(this.reads.length);
    this.reconfigureEntered.resolve();
    return this.reconfigureGate;
  }
  ready(): Promise<void> {
    this.readyEntered.resolve();
    return this.readyGate;
  }
}
