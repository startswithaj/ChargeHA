import type {
  AdapterVehicleChargeState,
  CallContext,
  VehicleAdapter,
} from "@chargeha/shared";
import type {
  VehicleMiddleware,
  VehicleRequestContext,
} from "../../../types.ts";
import type { Logger } from "@chargeha/server/lib/Logger";
import { TeslaApiStrategy } from "./TeslaApiStrategy.ts";

// Rate-limit floor for the free /vehicles probe in the polling path.
// Caps probes at 1/min/vehicle regardless of controller loop config,
// keeping us well clear of Tesla's /vehicles rate limit (~13/min).
// Bypassed for forceRefresh (user-initiated) and command paths.
const ONLINE_CHECK_DEBOUNCE_MS = 60_000;

/**
 * Tesla-specific vehicle middleware. Wraps the adapter with caching and
 * cost-aware API decisions. All wake/fetch/staleness logic is delegated
 * to TeslaApiStrategy — this class only handles I/O execution.
 */
export class TeslaVehicleMiddleware implements VehicleMiddleware {
  private readonly adapter: VehicleAdapter;
  private readonly logger: Logger;
  private readonly strategy: TeslaApiStrategy;

  // isOnline lives on lastKnownOnline (live, refreshed every probe).
  // Strip it from the cached snapshot to avoid two sources of truth —
  // getCachedState() merges them when returning to consumers.
  private cachedState: Omit<AdapterVehicleChargeState, "isOnline"> | null =
    null;
  private lastKnownOnline = false;
  private lastFetchAtMs = 0;
  private lastWakeAtMs = 0;
  private lastOnlineCheckAtMs = 0;

  constructor(adapter: VehicleAdapter, logger: Logger) {
    this.adapter = adapter;
    this.logger = logger;
    this.strategy = new TeslaApiStrategy();
  }

  // ── Public: data ──────────────────────────────────────────────────────

  get online(): boolean {
    return this.lastKnownOnline;
  }

  getCachedState(): AdapterVehicleChargeState | null {
    return this.cachedState
      ? { ...this.cachedState, isOnline: this.lastKnownOnline }
      : null;
  }

  seedState(state: AdapterVehicleChargeState): void {
    if (this.cachedState) {
      this.logger.debug("seedState skipped: cache already has data");
      return;
    }
    this.logger.debug(
      `seedState: batteryLevel=${state.batteryLevel}% pluggedIn=${state.isPluggedIn}`,
    );
    const { isOnline: _isOnline, ...rest } = state;
    this.cachedState = rest;
  }

  async requestState(
    context: VehicleRequestContext,
  ): Promise<AdapterVehicleChargeState | null> {
    this.logger.debug(
      `requestState origin=${context.origin} solar=${context.hasSolar} schedule=${context.hasSchedule} blockout=${context.hasBlockout} forceRefresh=${!!context
        .forceRefresh}`,
    );

    // Adapter errors (network failures, 5xx, auth expiry) propagate up to
    // VehicleManager, which reports them as a fetch error on the dashboard
    // and falls back to cached state. The "asleep, wake not justified" path
    // is not an error — it's expected behavior and stays silent.
    const wasOnline = this.lastKnownOnline;
    const isOnline = await this.checkVehicleOnline(
      context,
      !!context.forceRefresh,
    );

    const cameOnline = isOnline && !wasOnline;
    const cacheFresh = this.strategy.isCacheFresh(
      context,
      this.getCachedState(),
      this.lastFetchAtMs,
    );
    const canUseCache = !context.forceRefresh && cacheFresh;
    const wakeReason = this.strategy.shouldWake(
      context,
      this.getCachedState(),
      this.lastWakeAtMs,
    );

    // 1. shouldWake() relies on cached.isPluggedIn to decide whether waking
    //    is worth $0.02. That cached value is only refreshed when the car
    //    is online, so we must constantly watch for the offline→online
    //    transition (free /vehicles probe) and immediately fetch fresh state
    //    when it happens — otherwise a plug-in event silently leaves the
    //    cache stale and shouldWake keeps skipping forever.
    if (cameOnline) {
      this.logger.info("Vehicle came online — refreshing state");
      return this.fetchAndCache(withSuffix(context, "transition"));
    }

    // 2. Cache fresh → use it
    if (canUseCache) {
      const age = Math.round((Date.now() - this.lastFetchAtMs) / 1000);
      this.logger.debug(`Cache fresh (age=${age}s) — returning cached state`);
      return this.getCachedState();
    }

    // 3. Online → fetch fresh
    if (isOnline) {
      this.logger.debug("Online with stale cache — fetching fresh state");
      return this.fetchAndCache(withSuffix(context, "request_vehicle_data"));
    }

    // 4. Asleep but worth waking → wake, then fetch
    if (wakeReason) {
      this.logger.info(
        `Asleep — waking to refresh state (reason=${wakeReason})`,
      );
      return this.wakeAndFetch(withSuffix(context, `wake:${wakeReason}`));
    }

    // 5. Asleep, not worth waking → return stale cache
    this.logger.debug(
      `Skip wake: battery=${this.cachedState?.batteryLevel}% limit=${this.cachedState?.chargeLimit}% schedule=${context.hasSchedule} solar=${context.hasSolar} blockout=${context.hasBlockout}`,
    );
    this.lastFetchAtMs = Date.now();
    return this.getCachedState();
  }

  // ── Public: commands ──────────────────────────────────────────────────

  async startCharging(ctx: CallContext): Promise<boolean> {
    this.logger.debug(`startCharging origin=${ctx.origin}`);
    await this.ensureOnline(withSuffix(ctx, "pre"));
    const ok = await this.adapter.startCharging(ctx);
    if (ok && this.cachedState) {
      this.cachedState = {
        ...this.cachedState,
        isCharging: true,
        lastUpdated: new Date().toISOString(),
      };
      this.logger.debug("startCharging confirmed — updated cache");
    } else if (!ok) {
      await this.refreshCacheAfterRejection(withSuffix(ctx, "post-reject"));
    }
    return ok;
  }

  async stopCharging(ctx: CallContext): Promise<boolean> {
    this.logger.debug(`stopCharging origin=${ctx.origin}`);
    await this.ensureOnline(withSuffix(ctx, "pre"));
    const ok = await this.adapter.stopCharging(ctx);
    if (ok && this.cachedState) {
      this.cachedState = {
        ...this.cachedState,
        isCharging: false,
        chargePowerKw: 0,
        chargeAmps: 0,
        lastUpdated: new Date().toISOString(),
      };
      this.logger.debug("stopCharging confirmed — updated cache");
    } else if (!ok) {
      await this.refreshCacheAfterRejection(withSuffix(ctx, "post-reject"));
    }
    return ok;
  }

  async setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    this.logger.debug(`setChargeAmps amps=${amps} origin=${ctx.origin}`);
    await this.ensureOnline(withSuffix(ctx, "pre"));
    const ok = await this.adapter.setChargeAmps(amps, ctx);
    if (ok && this.cachedState) {
      this.cachedState = {
        ...this.cachedState,
        chargeAmps: amps,
        lastUpdated: new Date().toISOString(),
      };
      this.logger.debug(`setChargeAmps confirmed — cache amps=${amps}`);
    } else if (!ok) {
      await this.refreshCacheAfterRejection(withSuffix(ctx, "post-reject"));
    }
    return ok;
  }

  /** Command was rejected by the vehicle (e.g. `is_charging` on charge_start).
   *  Cached state is out of sync with reality — pull fresh vehicle_data so the
   *  next decision loop sees the truth and doesn't retry the same command.
   *  Costs $0.002 per rejection, bounded by VehicleManager's command backoff. */
  private async refreshCacheAfterRejection(ctx: CallContext): Promise<void> {
    try {
      await this.fetchAndCache(ctx);
      this.logger.info(
        "Refreshed vehicle_data after command rejection — cache resynced",
      );
    } catch (e) {
      this.logger.warn("Failed to refresh vehicle_data after rejection", e);
    }
  }

  /** Ensure the vehicle is online before sending a command. Always does a
   *  cheap online check (free) — `lastKnownOnline` can be minutes stale for
   *  dashboard-initiated commands, so we can't trust it. If the check says
   *  offline, wake and retry. Commands are user-initiated (charge_now,
   *  dashboard buttons), so there's no wake-cooldown — we pay the wake cost
   *  when the user asks for action. Throws if wake fails so the caller can
   *  apply backoff and surface the error. */
  private async ensureOnline(ctx: CallContext): Promise<void> {
    const isOnline = await this.adapter.isVehicleOnline(ctx);
    if (isOnline) {
      this.lastKnownOnline = true;
      return;
    }
    this.logger.info("Waking vehicle before command");
    this.lastWakeAtMs = Date.now();
    const woke = await this.adapter.wakeVehicle(withSuffix(ctx, "wake"));
    if (!woke) {
      throw new Error("wakeVehicle rejected by vehicle");
    }
    this.lastKnownOnline = true;
  }

  // ── Private: I/O ──────────────────────────────────────────────────────

  /** Free online check via /vehicles endpoint ($0). Debounced for the
   *  polling path so high-frequency callers don't burn Tesla rate-limit
   *  quota. Pass `force=true` for user-initiated refreshes that need
   *  truth immediately (commands bypass this method entirely). */
  private async checkVehicleOnline(
    ctx: CallContext,
    force: boolean,
  ): Promise<boolean> {
    const since = Date.now() - this.lastOnlineCheckAtMs;
    if (!force && since < ONLINE_CHECK_DEBOUNCE_MS) {
      this.logger.debug(
        `Online check debounced (${since}ms < ${ONLINE_CHECK_DEBOUNCE_MS}ms)`,
      );
      return this.lastKnownOnline;
    }
    const isOnline = await this.adapter.isVehicleOnline(ctx);
    this.lastKnownOnline = isOnline;
    this.lastOnlineCheckAtMs = Date.now();
    return isOnline;
  }

  /** Fetch vehicle data from the adapter and update the cache ($0.002). */
  private async fetchAndCache(
    ctx: CallContext,
  ): Promise<AdapterVehicleChargeState | null> {
    const state = await this.adapter.getChargeState(ctx);
    state.lastUpdated = new Date().toISOString();

    this.lastKnownOnline = state.isOnline;
    this.lastFetchAtMs = Date.now();
    const { isOnline: _isOnline, ...rest } = state;
    this.cachedState = rest;

    return this.getCachedState();
  }

  /** Wake the vehicle ($0.02), then fetch fresh state. */
  private async wakeAndFetch(
    ctx: CallContext,
  ): Promise<AdapterVehicleChargeState | null> {
    this.logger.info("Waking vehicle");
    this.lastWakeAtMs = Date.now();

    const woke = await this.adapter.wakeVehicle(ctx);
    if (!woke) {
      this.logger.warn("Wake failed");
      return null;
    }

    this.lastKnownOnline = true;
    return this.fetchAndCache(withSuffix(ctx, "request_vehicle_data"));
  }
}

function withSuffix(ctx: CallContext, suffix: string): CallContext {
  return { ...ctx, origin: `${ctx.origin}:${suffix}` };
}
