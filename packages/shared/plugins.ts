import type { AnyRouter } from "@trpc/server";
import type { Hono } from "hono";
import type { SectionDef } from "./configSections.ts";
import type {
  AdapterVehicleChargeState,
  CallContext,
  ChargerConfigMap,
  ChargerInfo,
  ChargerRow,
  ChargerSecretsMap,
  ChargerState,
  EnergySourceAdapter,
  VehicleRow,
} from "./types.ts";

// ── Health Check Types ──────────────────────────────────────────────────────

export interface HealthCheckResult {
  /** "warning" is degraded-but-working: the plugin is doing its job, but with
   *  reduced capability the user should know about. Reserve "error" for
   *  conditions the user must act on for charging to work at all. */
  status: "ok" | "warning" | "error" | "timeout";
  /** Shown to the user in place of `warningMessage` when present, so a check
   *  that can fail in more than one way describes the failure it actually
   *  hit. Write it for the user, not for the log. */
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

// ── HTTP Route Types ────────────────────────────────────────────────────────

/** HTTP routes a plugin contributes. Core owns the URL — vehicles mount at
 *  /api/vehicle/<id>, chargers at /api/charger/<id>; plugins only supply
 *  the router. public marks device-facing endpoints that cannot do session
 *  auth; they apply their own device-appropriate auth in the handler. */
export interface PluginHttpRoutes {
  routes: Hono;
  public?: boolean;
}

/** The single place URL policy is applied, used by both registries. */
export const resolveHttpRoutes = (
  prefix: string,
  entries: Array<[string, PluginHttpRoutes | null]>,
): Array<{ fullPath: string; routes: Hono; public: boolean }> =>
  entries
    .filter((entry): entry is [string, PluginHttpRoutes] => entry[1] !== null)
    .map(([id, httpRoutes]) => ({
      fullPath: `${prefix}/${id}`,
      routes: httpRoutes.routes,
      public: httpRoutes.public ?? false,
    }));

// ── Base Plugin Interface ───────────────────────────────────────────────────

/** Static identity + config + lifecycle shared by all plugin types. */
export interface BasePlugin {
  readonly id: string;
  readonly displayName: string;
  readonly configDef: SectionDef;
  /** Which of `configDef`'s keys hold credentials. A pure classification,
   *  independent of where the value is stored: for plugin-wide config it
   *  selects the encrypted `config` rows, and for a charger row it selects
   *  the encrypted `charger_secrets` column over plain `charger_config`. */
  readonly secretKeys: readonly string[];
  getRouter(): AnyRouter | null;
  /** Health checks surfaced as dashboard warnings when they fail. Checks
   *  should self-guard on "am I configured" so unconfigured plugins stay
   *  silent. Return [] when the plugin has nothing to report. */
  getHealthChecks(): PluginHealthCheck[];
  /** Await any in-flight startup work and release resources. */
  shutdown(): Promise<void>;
}

// ── Vehicle Plugin ──────────────────────────────────────────────────────────

/**
 * A vehicle plugin (e.g. Tesla, Simulated). Takes `PluginDependencies` in
 * its constructor and kicks off async startup internally — no separate
 * `initialize(deps)` call, no separate instance wrapper.
 */
export interface CommandStatus {
  commandsDisabled: boolean;
  reason: string | null;
}

export interface VehiclePlugin extends BasePlugin {
  readonly settingsComponentKey: string | null;
  /** True when this plugin's vehicles draw no real power — the charging is
   *  invented, so no meter, real or simulated, can observe it. Their draw is
   *  therefore added to every energy reading. Defaults to false: a real car
   *  charging is measured by real hardware. See docs/simulated-load.md. */
  readonly loadIsUnmetered?: boolean;
  createVehicleMiddleware(row: VehicleRow): Promise<VehicleMiddleware>;
  getVehicleHttpRoutes(): PluginHttpRoutes | null;
  getTunnelRoutes(): PluginTunnelRoute[];
  /** Whether this plugin's vehicles can accept commands right now, with a
   *  user-facing reason when they can't. */
  getCommandStatus(): Promise<CommandStatus>;
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
  /** False when this adapter measures no real electricity and invents its
   *  figures instead — nothing charging appears in them, so charging load has
   *  to be added on top. Defaults to true: a real inverter has already counted
   *  whatever its meter saw. See docs/simulated-load.md. */
  readonly measuresLoad?: boolean;
  /** Build the energy adapter from current config. Called by
   *  EnergyAdapterManager during initial setup and on reconfigure. */
  createAdapter(): Promise<EnergySourceAdapter>;
}

// ── Charger Middleware ──────────────────────────────────────────────────────

/** Same layering as vehicles: the manager never touches an adapter
 *  directly — everything flows through the middleware, which owns caching
 *  and fetch-cost decisions. */
export interface ChargerMiddleware {
  /** Request charger state. The middleware decides cache vs fresh fetch
   *  based on its polling/push model. */
  requestState(ctx: CallContext): Promise<ChargerState | null>;
  /** Last cached state, no device calls triggered. */
  getCachedState(): ChargerState | null;
  // No `online` flag: nothing consumes it, and it would lie for push
  // adapters (a cached read never fails). Connectivity surfaces through
  // status: "faulted" + statusDetail, which the UI already renders.
  getChargerInfo(ctx: CallContext): Promise<ChargerInfo>;
  startCharging(ctx: CallContext): Promise<boolean>;
  stopCharging(ctx: CallContext): Promise<boolean>;
  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean>;
  /** Release device connections/timers on shutdown or rebuild. */
  shutdown(): Promise<void>;
}

// ── Charger Plugin ──────────────────────────────────────────────────────────

/**
 * One charger row's plugin config, resolved by the host before the plugin is
 * called.
 *
 * `config` is the row's plain `charger_config`; `secrets` is the row's
 * `charger_secrets`, already decrypted — the plugin never sees ciphertext and
 * never holds the encryption key. Both are scoped to a single charger row, so
 * two chargers of one adapter type cannot collide on the same credentials.
 *
 * Absence of a key is `undefined`, never `""` — the storage layer converts at
 * the boundary.
 *
 * Which keys arrive in which half is decided by the plugin's own
 * `secretKeys` allowlist. See `BasePlugin.secretKeys`.
 */
export interface ChargerRowConfig {
  readonly config: ChargerConfigMap;
  readonly secrets: ChargerSecretsMap;
}

/**
 * A charger row together with its resolved config, from
 * `PluginDependencies.resolveChargerConfigs()`.
 *
 * For the cases that must answer "which of my chargers is this?" — health
 * checks, OCPP pairing, and the OCPP websocket route — where there is no
 * longer a single answer.
 */
export interface ResolvedChargerRow extends ChargerRowConfig {
  readonly row: ChargerRow;
}

export interface ChargerPlugin extends BasePlugin {
  readonly vendor: string;
  readonly settingsComponentKey: string | null;
  /** True when this plugin's charging points move no real electricity, so no
   *  meter can observe them and their draw is added to every energy reading.
   *  Defaults to false: a real charger's draw is already on the real meter,
   *  and a simulator speaking a hardware protocol (OCPP) is indistinguishable
   *  from one over the wire. See docs/simulated-load.md. */
  readonly loadIsUnmetered?: boolean;
  /**
   * Build the middleware for one charger row.
   *
   * `row` identifies the charger and carries its non-plugin fields; `resolved`
   * carries the row's plugin config and decrypted secrets, read from the
   * database by ChargingPointManager immediately before this call. Plugins
   * never query the DB here — everything needed is already an argument.
   *
   * Throwing is the correct response to missing or invalid config: the host
   * catches it and registers an UnconfiguredChargerMiddleware carrying the
   * message, so the dashboard says what is wrong instead of the charger
   * silently doing nothing.
   */
  createChargerMiddleware(
    row: ChargerRow,
    resolved: ChargerRowConfig,
  ): Promise<ChargerMiddleware>;
  getChargerHttpRoutes(): PluginHttpRoutes | null;
}
