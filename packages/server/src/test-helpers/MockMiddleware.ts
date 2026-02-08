import type { VehicleChargeState } from "@chargeha/shared";
import type {
  VehicleMiddleware,
  VehicleRequestContext,
} from "@chargeha/plugins/types";

/**
 * Controllable middleware stub used by VehicleManager tests. Tracks calls and
 * lets tests drive responses by mutating fields on the instance
 * (`nextState`, `startResult`, etc.) before calling through.
 */
export class MockMiddleware implements VehicleMiddleware {
  requestStateCalls: VehicleRequestContext[] = [];
  startCalls: string[] = [];
  stopCalls: string[] = [];
  setAmpsCalls: Array<{ amps: number; origin: string }> = [];
  online = true;
  nextState: VehicleChargeState;
  requestStateImpl: (() => Promise<VehicleChargeState | null>) | null = null;
  startResult = true;
  stopResult = true;
  setAmpsResult = true;
  private cached: VehicleChargeState | null = null;

  constructor(initialState: VehicleChargeState) {
    this.nextState = { ...initialState };
  }

  requestState(
    context: VehicleRequestContext,
  ): Promise<VehicleChargeState | null> {
    this.requestStateCalls.push(context);
    if (this.requestStateImpl) return this.requestStateImpl();
    this.cached = { ...this.nextState };
    this.online = this.cached.isOnline;
    return Promise.resolve(this.cached);
  }

  getCachedState(): VehicleChargeState | null {
    return this.cached ? { ...this.cached } : null;
  }

  seedState(state: VehicleChargeState): void {
    if (this.cached) return;
    this.cached = { ...state };
  }

  startCharging(ctx: { origin: string }): Promise<boolean> {
    this.startCalls.push(ctx.origin);
    return Promise.resolve(this.startResult);
  }

  stopCharging(ctx: { origin: string }): Promise<boolean> {
    this.stopCalls.push(ctx.origin);
    if (this.cached && this.stopResult) {
      this.cached = { ...this.cached, isCharging: false };
    }
    return Promise.resolve(this.stopResult);
  }

  setChargeAmps(amps: number, ctx: { origin: string }): Promise<boolean> {
    this.setAmpsCalls.push({ amps, origin: ctx.origin });
    if (this.cached && this.setAmpsResult) {
      this.cached = { ...this.cached, chargeAmps: amps };
    }
    return Promise.resolve(this.setAmpsResult);
  }
}
