import type { AnyRouter } from "@trpc/server";
import type { Hono } from "hono";
import type { SectionDef } from "@chargeha/shared/configSections";
import type {
  AdapterVehicleChargeState,
  CallContext,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { VehicleRow } from "@chargeha/server/db/types";

// ── Health Check Types ──────────────────────────────────────────────────────

export interface HealthCheckResult {
  status: "ok" | "error" | "timeout";
  message?: string;
}

export interface PluginHealthCheck {
  name: string;
  timeoutMs?: number;
  /** User-facing warning title shown when this check fails. */
  warningTitle?: string;
  /** User-facing warning message shown when this check fails. */
  warningMessage?: string;
  run(): Promise<HealthCheckResult>;
}

// ── Tunnel Route Types ──────────────────────────────────────────────────────

/** A route registered by a plugin on the tunnel middleware server. */
export interface PluginTunnelRoute {
  path: string;
  /** Custom handler for this route. */
  handler?: (req: Request) => Response | Promise<Response>;
  /** If true, proxy the request to the main ChargeHA server at the same path. */
  proxy?: boolean;
}

// ── Base Plugin Interface ───────────────────────────────────────────────────

/** Static identity + config + lifecycle shared by all plugin types. */
export interface BasePlugin {
  readonly id: string;
  readonly displayName: string;
  readonly configDef: SectionDef;
  readonly secretKeys: readonly string[];
  getRouter(): AnyRouter | null;
  /** Await any in-flight startup work and release resources. */
  shutdown(): Promise<void>;
}

// ── Vehicle Plugin ──────────────────────────────────────────────────────────

/**
 * A vehicle plugin (e.g. Tesla, Simulated). Takes `PluginDependencies` in
 * its constructor and kicks off async startup internally — no separate
 * `initialize(deps)` call, no separate instance wrapper.
 */
export interface VehiclePlugin extends BasePlugin {
  readonly settingsComponentKey: string | null;
  createMiddleware(row: VehicleRow): Promise<VehicleMiddleware>;
  getHttpRoutes(): Hono | null;
  getHealthChecks(): PluginHealthCheck[];
  getTunnelRoutes(): PluginTunnelRoute[];
}

// ── Vehicle Middleware ──────────────────────────────────────────────────────

/** Context passed to the middleware so it can make cost-aware decisions
 *  about caching, online checks, and wakes. Extends CallContext so logs
 *  inherit the caller's origin + traceId. */
export interface VehicleRequestContext extends CallContext {
  hasSolar: boolean;
  hasSchedule: boolean;
  hasBlockout: boolean;
  scheduleChargeLimitPct?: number | null;
  /** When true, skip cache and wake if needed. Used for user-initiated
   *  refresh/wake commands from the dashboard. */
  forceRefresh?: boolean;
}

/** Wraps a VehicleAdapter with caching, debouncing, and cost-aware API
 *  decisions. Each plugin provides its own implementation (e.g.
 *  TeslaVehicleMiddleware optimises for the Tesla Fleet API cost model).
 *  The middleware is a pure data + command layer — no event emission,
 *  no transition detection. VehicleManager handles events. */
export interface VehicleMiddleware {
  /** Request vehicle state. The middleware decides whether to serve from
   *  cache, do a cheap online check, fetch fresh data, or wake the car
   *  based on context and its internal cost model. */
  requestState(
    context: VehicleRequestContext,
  ): Promise<AdapterVehicleChargeState | null>;

  /** Return the last cached state without triggering any API calls. */
  getCachedState(): AdapterVehicleChargeState | null;

  /** Seed cached state from historical data (e.g. controller logs on
   *  startup) so the dashboard shows values while the car is asleep.
   *  No-op if cache already has data. */
  seedState(state: AdapterVehicleChargeState): void;

  /** Whether the vehicle responded as online on the last request. */
  readonly online: boolean;

  /** Start charging. Wakes the vehicle internally if asleep. */
  startCharging(ctx: CallContext): Promise<boolean>;

  /** Stop charging. */
  stopCharging(ctx: CallContext): Promise<boolean>;

  /** Set charging amperage. Wakes the vehicle internally if asleep. */
  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean>;
}

// ── Energy Plugin ───────────────────────────────────────────────────────────

/**
 * An energy plugin (e.g. Fronius Local, Fronius Cloud). Takes
 * `PluginDependencies` in its constructor. Exposes `createAdapter()` which
 * returns the active adapter after reading current config.
 */
export interface EnergyPlugin extends BasePlugin {
  readonly vendor: string;
  readonly settingsComponentKey: string | null;
  /** Build the energy adapter from current config. Called by
   *  EnergyAdapterManager during initial setup and on reconfigure. */
  createAdapter(): Promise<EnergySourceAdapter>;
}
