import type { VehicleChargeState } from "@chargeha/shared";

/**
 * Generic vehicle adapter stub used by the vehicles tRPC router tests.
 * Records all command invocations in `commandCalls` for later assertion.
 */
export class MockVehicleAdapter {
  vehicleId: string;
  chargeState: VehicleChargeState;
  isOnline = true;
  commandCalls: Array<{ command: string; args?: unknown }> = [];

  constructor(vehicleId: string, baseState: VehicleChargeState) {
    this.vehicleId = vehicleId;
    this.chargeState = { ...baseState, vehicleId };
  }

  getChargeState(_ctx: unknown): Promise<VehicleChargeState> {
    return Promise.resolve({ ...this.chargeState });
  }

  isVehicleOnline(_ctx: unknown): Promise<boolean> {
    return Promise.resolve(this.isOnline);
  }

  connect(_ctx: unknown): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  startCharging(_ctx: unknown): Promise<boolean> {
    this.commandCalls.push({ command: "startCharging" });
    return Promise.resolve(true);
  }

  stopCharging(_ctx: unknown): Promise<boolean> {
    this.commandCalls.push({ command: "stopCharging" });
    return Promise.resolve(true);
  }

  setChargeAmps(amps: number, _ctx: unknown): Promise<boolean> {
    this.commandCalls.push({ command: "setChargeAmps", args: amps });
    return Promise.resolve(true);
  }

  setChargeLimit(percent: number, _ctx: unknown): Promise<boolean> {
    this.commandCalls.push({ command: "setChargeLimit", args: percent });
    return Promise.resolve(true);
  }

  wakeVehicle(_ctx: unknown): Promise<boolean> {
    this.commandCalls.push({ command: "wakeVehicle" });
    return Promise.resolve(true);
  }

  getVehicleInfo(_ctx: unknown): Promise<
    { id: string; name: string; manufacturer: string; model: string }
  > {
    return Promise.resolve({
      id: this.vehicleId,
      name: "Test Car",
      manufacturer: "Tesla",
      model: "Model 3",
    });
  }
}
