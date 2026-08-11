import type { AnyRouter } from "@trpc/server";
import type { Hono } from "hono";
import type { SectionDef } from "./configSections.ts";
import type {
  AdapterVehicleChargeState,
  CallContext,
  ChargerConfigMap,
  ChargerRow,
  ChargerSecretsMap,
  ChargerState,
  EnergySourceAdapter,
  VehicleRow,
} from "./types.ts";

// ── Health Check Types ──────────────────────────────────────────────────────

export interface HealthCheckResult {
  // "warning" is degraded-but-working: the plugin works but with reduced
  // capability. Reserve "error" for conditions the user must act on.
  status: "ok" | "warning" | "error" | "timeout";
  // Shown to the user in place of `warningMessage` when present — write it
  // for the user, describing the failure this check actually hit.
  message?: string;
}

export interface PluginHealthCheck {
  name: string;
  timeoutMs?: number;
  warningTitle?: string;
  warningMessage?: string;
  run(): Promise<HealthCheckResult>;
}

// ── Tunnel Route Types ──────────────────────────────────────────────────────

// A route registered by a plugin on the tunnel middleware server.
export interface PluginTunnelRoute {
  path: string;
  handler?: (req: Request) => Response | Promise<Response>;
  // If true, proxy the request to the main ChargeHA server at the same path.
  proxy?: boolean;
}

// ── HTTP Route Types ────────────────────────────────────────────────────────

// HTTP routes a plugin contributes. Core owns the URL; public marks
// device-facing endpoints that apply their own device-appropriate auth.
export interface PluginHttpRoutes {
  routes: Hono;
  public?: boolean;
}

// The single place URL policy is applied, used by both registries.
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

// Static identity + config + lifecycle shared by all plugin types.
export interface BasePlugin {
  readonly id: string;
  readonly displayName: string;
  readonly configDef: SectionDef;
  // Which of `configDef`'s keys hold credentials — encrypted `config` rows
  // for plugin-wide config, or encrypted `charger_secrets` for a charger row.
  readonly secretKeys: readonly string[];
  getRouter(): AnyRouter | null;
  // Health checks surfaced as dashboard warnings when they fail. Should
  // self-guard on "am I configured"; return [] when nothing to report.
  getHealthChecks(): PluginHealthCheck[];
  shutdown(): Promise<void>;
}

// ── Vehicle Plugin ──────────────────────────────────────────────────────────

// A vehicle plugin (e.g. Tesla, Simulated). Takes `PluginDependencies` in
// its constructor and kicks off async startup internally, no wrapper.
export interface CommandStatus {
  commandsDisabled: boolean;
  reason: string | null;
}

export interface VehiclePlugin extends BasePlugin {
  readonly settingsComponentKey: string | null;
  // True when this plugin's vehicles draw no real power, so their draw is
  // added to every energy reading. Defaults to false. See docs/simulated-load.md.
  readonly loadIsUnmetered?: boolean;
  createVehicleMiddleware(row: VehicleRow): Promise<VehicleMiddleware>;
  getVehicleHttpRoutes(): PluginHttpRoutes | null;
  getTunnelRoutes(): PluginTunnelRoute[];
  // Whether this plugin's vehicles can accept commands right now, with a
  // user-facing reason when they can't.
  getCommandStatus(): Promise<CommandStatus>;
}

// ── Vehicle Middleware ──────────────────────────────────────────────────────

// Context for cost-aware caching/online/wake decisions. Extends
// CallContext so logs inherit the caller's origin + traceId.
export interface VehicleRequestContext extends CallContext {
  hasSolar: boolean;
  hasSchedule: boolean;
  hasBlockout: boolean;
  scheduleChargeLimitPct?: number | null;
  // When true, skip cache and wake if needed. Used for user-initiated
  // refresh/wake commands from the dashboard.
  forceRefresh?: boolean;
}

// Wraps a VehicleAdapter with caching and cost-aware API decisions (each
// plugin has its own, e.g. Tesla optimises for Fleet API cost).
export interface VehicleMiddleware {
  // Decides whether to serve from cache, do a cheap online check, fetch
  // fresh data, or wake the car based on context and its cost model.
  requestState(
    context: VehicleRequestContext,
  ): Promise<AdapterVehicleChargeState | null>;

  // Return the last cached state without triggering any API calls.
  getCachedState(): AdapterVehicleChargeState | null;

  // Seed cached state from historical data (e.g. controller logs on
  // startup) so the dashboard shows values while the car is asleep.
  seedState(state: AdapterVehicleChargeState): void;

  // Whether the vehicle responded as online on the last request.
  readonly online: boolean;
}

// ── Energy Plugin ───────────────────────────────────────────────────────────

// An energy plugin (e.g. Fronius Local, Fronius Cloud). `createAdapter()`
// returns the active adapter after reading current config.
export interface EnergyPlugin extends BasePlugin {
  readonly vendor: string;
  readonly settingsComponentKey: string | null;
  // False when this adapter invents its figures instead of measuring real
  // electricity. Defaults to true. See docs/simulated-load.md.
  readonly measuresLoad?: boolean;
  // Build the energy adapter from current config. Called by
  // EnergyAdapterManager during initial setup and on reconfigure.
  createAdapter(): Promise<EnergySourceAdapter>;
}

// ── Charger Middleware ──────────────────────────────────────────────────────

// Same layering as vehicles: the manager never touches an adapter
// directly, everything flows through the middleware.
export interface ChargerMiddleware {
  // Request charger state. The middleware decides cache vs fresh fetch
  // based on its polling/push model.
  requestState(ctx: CallContext): Promise<ChargerState | null>;
  // Last cached state, no device calls triggered.
  getCachedState(): ChargerState | null;
  // No `online` flag: it would lie for push adapters. Connectivity
  // surfaces through status: "faulted" + statusDetail instead.
  startCharging(ctx: CallContext): Promise<boolean>;
  stopCharging(ctx: CallContext): Promise<boolean>;
  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean>;
  // Release device connections/timers on shutdown or rebuild.
  shutdown(): Promise<void>;
}

// ── Charger Plugin ──────────────────────────────────────────────────────────

// `config`/`secrets` are the row's plain/decrypted halves — the plugin
// never sees ciphertext. Absence is `undefined`, never `""`.
export interface ChargerRowConfig {
  readonly config: ChargerConfigMap;
  readonly secrets: ChargerSecretsMap;
}

// A charger row with its resolved config. Used where "which of my
// chargers is this?" has no single answer (health checks, OCPP).
export interface ResolvedChargerRow extends ChargerRowConfig {
  readonly row: ChargerRow;
}

export interface ChargerPlugin extends BasePlugin {
  readonly vendor: string;
  readonly settingsComponentKey: string | null;
  // True when this plugin's charging points move no real electricity, so
  // their draw is added to every reading. Defaults to false.
  readonly loadIsUnmetered?: boolean;
  // `resolved` carries config/secrets already read by ChargingPointManager.
  // Throw on invalid config; host catches it and shows the dashboard error.
  createChargerMiddleware(
    row: ChargerRow,
    resolved: ChargerRowConfig,
  ): Promise<ChargerMiddleware>;
  // Called after a charger row is deleted (not on rebuild), so a plugin
  // holding per-row state can release it.
  onChargerRemoved?(rowId: string): void;
  getChargerHttpRoutes(): PluginHttpRoutes | null;
}
