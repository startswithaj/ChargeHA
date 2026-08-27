import type { CallContext, ChargerState } from "@chargeha/shared";
import type { ChargerMiddleware } from "@chargeha/shared/plugins";

// Controllable ChargerMiddleware stub. Mirrors MockMiddleware's shape for
// vehicles — tracks calls, lets tests drive responses via mutable fields.
export class StubChargerMiddleware implements ChargerMiddleware {
  requestStateCalls: CallContext[] = [];
  startCalls: string[] = [];
  stopCalls: string[] = [];
  setAmpsCalls: Array<{ amps: number; origin: string }> = [];
  shutdownCalls = 0;
  nextState: ChargerState | null;
  startResult = true;
  stopResult = true;
  setAmpsResult = true;
  private cached: ChargerState | null = null;

  constructor(nextState: ChargerState | null) {
    this.nextState = nextState;
  }

  requestState(ctx: CallContext): Promise<ChargerState | null> {
    this.requestStateCalls.push(ctx);
    this.cached = this.nextState ? { ...this.nextState } : null;
    return Promise.resolve(this.cached);
  }

  getCachedState(): ChargerState | null {
    return this.cached;
  }

  // Seed the cache directly, bypassing requestState — used to test that
  // getState never triggers a device call.
  seedCache(state: ChargerState): void {
    this.cached = { ...state };
  }

  startCharging(ctx: CallContext): Promise<boolean> {
    this.startCalls.push(ctx.origin);
    return Promise.resolve(this.startResult);
  }

  stopCharging(ctx: CallContext): Promise<boolean> {
    this.stopCalls.push(ctx.origin);
    return Promise.resolve(this.stopResult);
  }

  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    this.setAmpsCalls.push({ amps, origin: ctx.origin });
    return Promise.resolve(this.setAmpsResult);
  }

  supportsRecovery(): boolean {
    return false;
  }

  recoverConnection(_ctx: CallContext): Promise<string[] | null> {
    return Promise.resolve(null);
  }

  softReset(_ctx: CallContext): Promise<boolean | null> {
    return Promise.resolve(null);
  }

  shutdown(): Promise<void> {
    this.shutdownCalls++;
    return Promise.resolve();
  }
}
