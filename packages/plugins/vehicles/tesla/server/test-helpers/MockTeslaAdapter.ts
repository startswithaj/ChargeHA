import type { VehicleChargeState } from "@chargeha/shared";
import { buildVehicleChargeState } from "@chargeha/shared/test-factories";

/**
 * Tesla-specific adapter stub used by TeslaVehicleMiddleware tests. Tracks
 * call counts and lets tests toggle isOnline / wakeResult / etc.
 */
export class MockTeslaAdapter {
  state: VehicleChargeState = buildVehicleChargeState();
  isOnline = true;
  wakeResult = true;
  startChargingResult = true;
  stopChargingResult = true;
  setChargeAmpsResult = true;

  getChargeStateCalls = 0;
  isVehicleOnlineCalls = 0;
  wakeVehicleCalls = 0;
  startChargingCalls = 0;
  stopChargingCalls = 0;
  setChargeAmpsCalls = 0;

  getChargeState(_ctx: unknown): Promise<VehicleChargeState> {
    this.getChargeStateCalls++;
    return Promise.resolve({ ...this.state });
  }

  isVehicleOnline(_ctx: unknown): Promise<boolean> {
    this.isVehicleOnlineCalls++;
    return Promise.resolve(this.isOnline);
  }

  wakeVehicle(_ctx: unknown): Promise<boolean> {
    this.wakeVehicleCalls++;
    return Promise.resolve(this.wakeResult);
  }

  startCharging(_ctx: unknown): Promise<boolean> {
    this.startChargingCalls++;
    return Promise.resolve(this.startChargingResult);
  }

  stopCharging(_ctx: unknown): Promise<boolean> {
    this.stopChargingCalls++;
    return Promise.resolve(this.stopChargingResult);
  }

  setChargeAmps(_amps: number, _ctx: unknown): Promise<boolean> {
    this.setChargeAmpsCalls++;
    return Promise.resolve(this.setChargeAmpsResult);
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  setChargeLimit(): Promise<boolean> {
    return Promise.resolve(true);
  }
  getVehicleInfo() {
    return Promise.resolve({
      id: "VIN",
      name: "Test",
      manufacturer: "Tesla",
      model: "3",
    });
  }
}
