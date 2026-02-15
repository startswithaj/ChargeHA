import type { AdapterVehicleChargeState } from "@chargeha/shared";
import type { VehicleRequestContext } from "../../../types.ts";

// Cache freshness — tuned for Tesla Fleet API cost model ($10/month credit)
//
// | Condition                  | Stale after |
// |----------------------------|-------------|
// | No state yet               | 3 min       |
// | Online + unplugged         | 5 min       |
// | Schedule or solar active   | 10 min      |
// | Idle (no reason to charge) | 20 min      |
//
// Online+unplugged is tighter because Tesla sleeps ~5-6 min after plug-in if
// not actively charging. If we don't refresh vehicle_data inside that window,
// the car sleeps with cache showing unplugged and shouldWake() then skips the
// wake — plug-in event lost.

const NO_STATE_MS = 3 * 60 * 1000;
const ONLINE_UNPLUGGED_MS = 5 * 60 * 1000;
const CAN_CHARGE_MS = 10 * 60 * 1000;
const CANT_CHARGE_MS = 20 * 60 * 1000;

// Wake rate limit — max one wake per hour ($0.02 each)
const WAKE_COOLDOWN_MS = 60 * 60 * 1000;

/** Why a wake was triggered. Surfaces in plugin log origins so wakes can be
 *  attributed to their cause when investigating cost or behavior. */
export type WakeReason = "schedule" | "solar" | "force_refresh";

/** Pure decision logic for Tesla Fleet API usage. No I/O — takes state,
 *  returns decisions. Keeps all cost-aware reasoning in one testable place. */
export class TeslaApiStrategy {
  /** Whether the cached state is fresh enough to skip a fetch. */
  isCacheFresh(
    context: VehicleRequestContext,
    cachedState: AdapterVehicleChargeState | null,
    lastFetchAtMs: number,
  ): boolean {
    if (!cachedState) return false;
    const elapsed = Date.now() - lastFetchAtMs;
    return elapsed < this.staleness(context, cachedState);
  }

  /** Whether a wake call ($0.02) is justified given the current context.
   *  - Always wakes for user-initiated forceRefresh
   *  - Allowed for schedules or solar (not blockouts)
   *  - Skipped when cached state shows the car isn't plugged in
   *    (Tesla wakes itself on plug-in, so the free /vehicles online check will
   *    catch it — no reason to spend $0.02 waking an unplugged car)
   *  - Skipped when cached battery is already at/over the charge limit
   *    (battery only drops while asleep, so a cached "full" reading stays valid;
   *    if the user drives the car it will come online naturally and refresh)
   *  - Rate-limited to once per hour */
  shouldWake(
    context: VehicleRequestContext,
    cachedState: AdapterVehicleChargeState | null,
    lastWakeAtMs: number,
  ): WakeReason | null {
    if (context.forceRefresh) return "force_refresh";
    // Blockout active — vehicle can't charge anyway, don't pay $0.02 to wake.
    if (context.hasBlockout) return null;
    if (!context.hasSchedule && !context.hasSolar) return null;
    // Not plugged in — Tesla wakes itself on plug-in, free /vehicles check catches it
    if (cachedState && !cachedState.isPluggedIn) return null;
    // Effective limit = min(vehicle chargeLimit, active schedule's
    // chargeLimitPct). Don't wake if already at or above it — the engine
    // would immediately stop charging, wasting $0.02 on the wake.
    if (cachedState) {
      const effectiveLimit = Math.min(
        cachedState.chargeLimit,
        context.scheduleChargeLimitPct ?? cachedState.chargeLimit,
      );
      if (cachedState.batteryLevel >= effectiveLimit) return null;
    }
    if ((Date.now() - lastWakeAtMs) < WAKE_COOLDOWN_MS) return null;
    // Schedule takes precedence in the reason label when both are active
    if (context.hasSchedule) return "schedule";
    return "solar";
  }

  /** How long before cached state is considered stale. */
  staleness(
    context: VehicleRequestContext,
    cachedState: AdapterVehicleChargeState | null,
  ): number {
    if (!cachedState) return NO_STATE_MS;
    // Online + unplugged: tight window so we catch plug-in before Tesla sleeps
    if (cachedState.isOnline && !cachedState.isPluggedIn) {
      return ONLINE_UNPLUGGED_MS;
    }
    if (context.hasSolar || context.hasSchedule) return CAN_CHARGE_MS;
    return CANT_CHARGE_MS;
  }
}
