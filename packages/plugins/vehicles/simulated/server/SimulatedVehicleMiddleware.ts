import type {
  AdapterVehicleChargeState,
  CallContext,
  VehicleAdapter,
} from "@chargeha/shared";
import type {
  VehicleMiddleware,
  VehicleRequestContext,
} from "../../../types.ts";

/**
 * Middleware for simulated vehicles. Simulator calls are free and instant,
 * so there is no cost model — every request fetches fresh state and the
 * cache only exists to serve `getCachedState()`.
 */
export class SimulatedVehicleMiddleware implements VehicleMiddleware {
  private cachedState: AdapterVehicleChargeState | null = null;

  constructor(private readonly adapter: VehicleAdapter) {}

  async requestState(
    context: VehicleRequestContext,
  ): Promise<AdapterVehicleChargeState | null> {
    this.cachedState = await this.adapter.getChargeState(context);
    return this.cachedState;
  }

  getCachedState(): AdapterVehicleChargeState | null {
    return this.cachedState;
  }

  seedState(state: AdapterVehicleChargeState): void {
    if (!this.cachedState) this.cachedState = state;
  }

  get online(): boolean {
    return true;
  }

  startCharging(ctx: CallContext): Promise<boolean> {
    return this.adapter.startCharging(ctx);
  }

  stopCharging(ctx: CallContext): Promise<boolean> {
    return this.adapter.stopCharging(ctx);
  }

  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    return this.adapter.setChargeAmps(amps, ctx);
  }
}
