import type {
  CallContext,
  ChargerAdapter,
  ChargerInfo,
  ChargerState,
} from "@chargeha/shared";
import type { ChargerMiddleware } from "@chargeha/shared/plugins";
import type { Logger } from "@chargeha/server/lib/Logger";

// Default middleware for free local-API chargers (Tapo, OCPP): caches state
// and enforces the adapter's poll interval. Push adapters
// (pollIntervalSeconds() === null) always serve current state.
export class PollingChargerMiddleware implements ChargerMiddleware {
  private cachedState: ChargerState | null = null;
  private lastFetchAt = 0;

  constructor(
    private readonly adapter: ChargerAdapter,
    private readonly logger: Logger,
  ) {}

  async requestState(ctx: CallContext): Promise<ChargerState | null> {
    const interval = this.adapter.pollIntervalSeconds();
    const due = interval === null ||
      Date.now() - this.lastFetchAt >= interval * 1000;
    if (!due) return this.cachedState;
    try {
      const state = await this.adapter.getChargerState(ctx);
      this.cachedState = state;
      this.lastFetchAt = Date.now();
      return state;
    } catch (error) {
      this.logger.error("Charger state fetch failed:", error);
      return this.cachedState; // stale beats blank; adapter staleness rules apply
    }
  }

  getCachedState(): ChargerState | null {
    return this.cachedState;
  }

  getChargerInfo(ctx: CallContext): Promise<ChargerInfo> {
    return this.adapter.getChargerInfo(ctx);
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

  async shutdown(): Promise<void> {
    await this.adapter.disconnect();
  }
}
