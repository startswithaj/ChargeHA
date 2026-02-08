import type {
  CumulativeEnergyData,
  EnergyData,
  VehicleChargeState,
} from "@chargeha/shared";
import type { EventMap } from "../services/TypedEventEmitter.ts";
import { TypedEventEmitter } from "../services/TypedEventEmitter.ts";

export class MockAdapter {
  vehicleId: string;
  state: VehicleChargeState;
  commands: Array<{ cmd: string; args?: unknown }> = [];
  startChargingResult = true;
  stopChargingResult = true;
  setChargeAmpsResult = true;

  constructor(id: string, state: VehicleChargeState) {
    this.vehicleId = id;
    this.state = { ...state };
  }

  getChargeState(_ctx: unknown): Promise<VehicleChargeState> {
    return Promise.resolve({ ...this.state });
  }
  isVehicleOnline(_ctx: unknown): Promise<boolean> {
    return Promise.resolve(true);
  }
  connect(_ctx: unknown): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  startCharging(_ctx: unknown): Promise<boolean> {
    this.commands.push({ cmd: "start" });
    if (this.startChargingResult) this.state.isCharging = true;
    return Promise.resolve(this.startChargingResult);
  }
  stopCharging(_ctx: unknown): Promise<boolean> {
    this.commands.push({ cmd: "stop" });
    if (this.stopChargingResult) {
      this.state.isCharging = false;
      this.state.chargeAmps = 0;
      this.state.chargePowerKw = 0;
    }
    return Promise.resolve(this.stopChargingResult);
  }
  setChargeAmps(amps: number, _ctx: unknown): Promise<boolean> {
    this.commands.push({ cmd: "setAmps", args: amps });
    if (this.setChargeAmpsResult) this.state.chargeAmps = amps;
    return Promise.resolve(this.setChargeAmpsResult);
  }
  setChargeLimit(_percent: number, _ctx: unknown): Promise<boolean> {
    this.commands.push({ cmd: "setLimit", args: _percent });
    return Promise.resolve(true);
  }
  wakeVehicle(_ctx: unknown): Promise<boolean> {
    this.commands.push({ cmd: "wake" });
    return Promise.resolve(true);
  }
  getVehicleInfo(_ctx: unknown) {
    return Promise.resolve({
      id: this.vehicleId,
      name: "Test",
      manufacturer: "Test",
      model: "Test",
    });
  }
}

export class MockEnergyPoller {
  snapshot: { realtime: EnergyData; cumulative: CumulativeEnergyData } | null =
    null;

  tryGetRealtimeSnapshot() {
    if (!this.snapshot) return null;
    return { timestamp: new Date().toISOString(), ...this.snapshot };
  }
}

/** Tracks all emitted events for test assertions. */
export class TrackingEventEmitter extends TypedEventEmitter {
  emitted: Array<{ type: string; data: unknown }> = [];

  override emit<T extends keyof EventMap>(
    event: T,
    data: EventMap[T],
  ): void {
    this.emitted.push({ type: event, data });
    super.emit(event, data);
  }

  controllerEvents() {
    return this.emitted.filter((e) =>
      e.type.startsWith("controller_") && e.type !== "controller_status"
    );
  }
}
