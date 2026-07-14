import type {
  AdapterVehicleChargeState,
  CallContext,
  VehicleChargeState,
} from "@chargeha/shared";
import { observable } from "@trpc/server/observable";
import type { Observable } from "@trpc/server/observable";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { VehicleRow } from "../db/types.ts";
import type { EventMap, TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { Logger } from "../lib/Logger.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type {
  VehicleMiddleware,
  VehicleRequestContext,
} from "@chargeha/plugins/types";
import { parseDecisionInputs } from "../db/Serialization.ts";
import { isHome, parseHomeCoords } from "@chargeha/shared/geo";

const RECENT_LOG_MS = 2 * 60 * 1000; // 2 minutes
const MAX_COMMAND_BACKOFF_SEC = 900; // 15 minutes

/** Result of a vehicle command (start/stop/setAmps/etc). */
export interface CommandResult {
  success: boolean;
  /** Updated state after command (if successful). */
  state?: VehicleChargeState;
  /** Error message (if failed). */
  error?: string;
}

/** Per-vehicle command backoff state. */
interface CommandBackoffState {
  failures: number;
  backoffUntil: number | null;
}

interface VehicleEntry {
  middleware: VehicleMiddleware;
}

/** Per-vehicle tracking for plug + home transition detection. */
interface PlugTracker {
  wasPluggedIn: boolean;
  wasHome: boolean | null;
  initialized: boolean;
}

/**
 * Internal layer that owns vehicle lifecycle and state. Wraps each vehicle's
 * plugin-provided VehicleMiddleware (which handles caching, API cost decisions,
 * and command execution) and adds:
 *
 * - Lifecycle: add/remove vehicles, sync with DB, initial state seeding
 * - Data access: requestState() for the controller, getState() for SSE/reads
 * - Commands: startChargingAt(), stopCharging() with clamping and backoff
 * - Plug transitions: detects plug-in/plug-out and emits events
 * - Error tracking: per-vehicle poll/command errors with exponential backoff
 * - SSE: subscribeToUpdates / subscribeToErrors for the dashboard
 * - Mode reset: switches charge_now/stop back to auto on unplug
 *
 * Consumers: ChargeController (data + commands), DataRecorder (data),
 * VehicleService (data + commands, from tRPC). None of them touch the plugin
 * adapter directly — everything flows through the middleware.
 */
export class VehicleManager {
  private vehicles = new Map<string, VehicleEntry>();
  private plugTrackers = new Map<string, PlugTracker>();
  private vehicleErrors = new Map<
    string,
    {
      message: string;
      at: string;
      vehicleName: string;
      source: "fetch" | "command";
    }
  >();
  private commandBackoff = new Map<string, CommandBackoffState>();
  private lastEmittedUpdatedAt = new Map<string, string>();
  private readonly db: AppDatabase;
  private readonly eventEmitter: TypedEventEmitter;
  private readonly logger: Logger;
  private readonly vehiclePlugins: VehiclePluginRegistry;

  constructor(
    db: AppDatabase,
    eventEmitter: TypedEventEmitter,
    logger: Logger,
    vehiclePlugins: VehiclePluginRegistry,
  ) {
    this.db = db;
    this.eventEmitter = eventEmitter;
    this.logger = logger;
    this.vehiclePlugins = vehiclePlugins;

    // Reset charge_now/stop → auto on unplug. Both are one-shot manual
    // overrides that should not persist across charging sessions.
    this.eventEmitter.subscribe("vehicle_plug_changed", (data) => {
      if (!data.isPluggedIn) {
        this.resetModeOnUnplug(data.vehicleId, data.vehicleName);
      }
    });
  }

  // ── Vehicle lifecycle ─────────────────────────────────────────────────

  async addVehicle(row: VehicleRow): Promise<void> {
    if (this.vehicles.has(row.id)) return;

    const plugin = this.vehiclePlugins.get(row.adapterType);
    if (!plugin) {
      this.logger.warn(
        `No plugin registered for adapter type "${row.adapterType}", skipping ${row.id}`,
      );
      return;
    }
    const middleware = await plugin.createMiddleware(row);

    this.vehicles.set(row.id, { middleware });
    this.plugTrackers.set(row.id, {
      wasPluggedIn: false,
      wasHome: null,
      initialized: false,
    });
    this.logger.info(`Vehicle registered: ${row.name} (${row.id})`);

    await this.seedFromRecentLog(row.id, row.name, middleware);
  }

  private async seedFromRecentLog(
    vehicleId: string,
    vehicleName: string,
    middleware: VehicleMiddleware,
  ): Promise<void> {
    try {
      const logs = await this.db.getLastControllerLogPerVehicle();
      const log = logs.find((l) => l.vehicleId === vehicleId);
      if (!log) return;

      const logAge = Date.now() - new Date(log.timestamp + "Z").getTime();
      if (logAge >= RECENT_LOG_MS) return;

      const inputs = parseDecisionInputs(log.inputsJson);
      if (!inputs?.vehicleState) return;
      const vs = inputs.vehicleState;

      middleware.seedState({
        vehicleId,
        vehicleName,
        batteryLevel: vs.batteryLevel,
        chargeLimit: vs.chargeLimit,
        isCharging: vs.isCharging,
        isPluggedIn: vs.isPluggedIn,
        isOnline: false,
        chargeAmps: vs.chargeAmps,
        chargeAmpsMax: vs.chargeAmpsMax,
        chargeAmpsMin: vs.chargeAmpsMin,
        chargePowerKw: 0,
        chargerVoltage: 0,
        chargerPhases: 1,
        energyAddedKwh: 0,
        minutesToFull: 0,
        chargePortOpen: vs.isPluggedIn,
        lastUpdated: new Date().toISOString(),
        latitude: vs.latitude ?? null,
        longitude: vs.longitude ?? null,
      });
      this.plugTrackers.set(vehicleId, {
        wasPluggedIn: vs.isPluggedIn,
        wasHome: null,
        initialized: true,
      });
      this.logger.info(
        `${vehicleName}: seeded from log (${Math.round(logAge / 1000)}s old)`,
      );
    } catch (e) {
      this.logger.debug(
        `${vehicleId}: could not seed from log, falling through to poll`,
        e,
      );
    }
  }

  // deno-lint-ignore require-await
  async removeVehicle(id: string): Promise<void> {
    this.vehicles.delete(id);
    this.plugTrackers.delete(id);
    this.vehicleErrors.delete(id);
    this.logger.info(`Vehicle removed: ${id}`);
  }

  /** Permanently delete a vehicle: drop live state, delete the row (cascades
   *  its schedules), and renumber remaining priorities so there are no gaps. */
  async deleteVehicle(id: string): Promise<void> {
    await this.removeVehicle(id);
    await this.db.deleteVehicle(id);
    await this.db.resequenceVehiclePriorities();
  }

  // ── Data requests ─────────────────────────────────────────────────────

  /** Request vehicle state via the middleware. Detects plug transitions
   *  and emits events when fresh data arrives. */
  async requestState(
    vehicleId: string,
    context: VehicleRequestContext,
  ): Promise<VehicleChargeState | null> {
    const entry = this.vehicles.get(vehicleId);
    if (!entry) return null;

    try {
      const raw = await entry.middleware.requestState(context);
      if (!raw) return null;
      const state = await this.wrapWithIsHome(raw);

      this.detectTransitions(vehicleId, state);

      if (this.lastEmittedUpdatedAt.get(vehicleId) !== state.lastUpdated) {
        this.lastEmittedUpdatedAt.set(vehicleId, state.lastUpdated);
        this.eventEmitter.emit("vehicle_update", state);
      }

      // Clear fetch errors on successful state fetch
      const stored = this.vehicleErrors.get(vehicleId);
      if (stored?.source === "fetch") {
        this.clearVehicleError(vehicleId);
      }

      return state;
    } catch (error) {
      const cached = entry.middleware.getCachedState();
      const vehicleName = cached?.vehicleName ?? vehicleId;
      this.reportVehicleError(
        vehicleId,
        vehicleName,
        error instanceof Error ? error.message : String(error),
        "fetch",
      );
      return cached ? await this.wrapWithIsHome(cached) : null;
    }
  }

  async getState(id: string): Promise<VehicleChargeState | null> {
    const raw = this.vehicles.get(id)?.middleware.getCachedState();
    if (!raw) return null;
    return await this.wrapWithIsHome(raw);
  }

  async getAllStates(): Promise<Map<string, VehicleChargeState>> {
    const home = parseHomeCoords(
      await this.db.getConfig("home_latitude"),
      await this.db.getConfig("home_longitude"),
    );
    return new Map(
      [...this.vehicles].flatMap(([id, entry]) => {
        const raw = entry.middleware.getCachedState();
        if (!raw) return [];
        const state: VehicleChargeState = { ...raw, isHome: isHome(home, raw) };
        return [[id, state] as const];
      }),
    );
  }

  private async wrapWithIsHome(
    raw: AdapterVehicleChargeState,
  ): Promise<VehicleChargeState> {
    const home = parseHomeCoords(
      await this.db.getConfig("home_latitude"),
      await this.db.getConfig("home_longitude"),
    );
    return { ...raw, isHome: isHome(home, raw) };
  }

  isVehicleAwake(vehicleId: string): boolean {
    return this.vehicles.get(vehicleId)?.middleware.online ?? false;
  }

  // ── Commands ──────────────────────────────────────────────────────────

  /** Start or adjust charging. Handles: clamp amps → set amps → start →
   *  error/backoff tracking. The middleware handles wake internally.
   *  Idempotent: only sends commands when state differs from target. */
  async startChargingAt(
    vehicleId: string,
    amps: number,
    ctx: CallContext,
    state: VehicleChargeState,
    { force = false } = {},
  ): Promise<CommandResult> {
    const entry = this.vehicles.get(vehicleId);
    if (!entry) return { success: false, error: "Vehicle not registered" };

    const { backedOff, remainingMs } = this.isBackedOff(vehicleId);
    if (backedOff && !force) {
      this.logger.info(
        `Command backoff active for ${vehicleId}, ${
          Math.round((remainingMs ?? 0) / 1000)
        }s remaining`,
      );
      return { success: false, error: "Command backoff active" };
    }

    try {
      const clampedAmps = Math.max(
        state.chargeAmpsMin,
        Math.min(state.chargeAmpsMax, Math.round(amps)),
      );

      const ampsChanged = state.chargeAmps !== clampedAmps;

      // Set amps first (whether or not currently charging)
      if (ampsChanged) {
        const ok = await entry.middleware.setChargeAmps(
          clampedAmps,
          { ...ctx, origin: `${ctx.origin}:set-amps` },
        );
        if (!ok) {
          throw new Error(
            `setChargeAmps(${clampedAmps}) rejected by vehicle`,
          );
        }
      }

      // Start charging if not already
      if (!state.isCharging) {
        const ok = await entry.middleware.startCharging(
          { ...ctx, origin: `${ctx.origin}:start` },
        );
        if (!ok) throw new Error("startCharging rejected by vehicle");
        this.logger.info(`Started ${vehicleId} at ${clampedAmps}A`);
      }

      this.resetCommandBackoff(vehicleId);
      this.clearVehicleError(vehicleId);
      return {
        success: true,
        state: (await this.getState(vehicleId)) ?? undefined,
      };
    } catch (error) {
      this.applyCommandBackoff(vehicleId, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Stop charging. Handles: send stop → error/backoff tracking.
   *  The middleware updates cached state on success.
   *  Idempotent: only sends stop when vehicle is currently charging. */
  async stopCharging(
    vehicleId: string,
    ctx: CallContext,
    state: VehicleChargeState,
    { force = false } = {},
  ): Promise<CommandResult> {
    const entry = this.vehicles.get(vehicleId);
    if (!entry) return { success: false, error: "Vehicle not registered" };

    if (!state.isCharging) {
      return { success: true, state };
    }

    const { backedOff, remainingMs } = this.isBackedOff(vehicleId);
    if (backedOff && !force) {
      this.logger.info(
        `Command backoff active for ${vehicleId}, ${
          Math.round((remainingMs ?? 0) / 1000)
        }s remaining`,
      );
      return { success: false, error: "Command backoff active" };
    }

    try {
      const ok = await entry.middleware.stopCharging(
        { ...ctx, origin: `${ctx.origin}:stop` },
      );
      if (!ok) throw new Error("stopCharging rejected by vehicle");
      this.logger.info(`Stopped ${vehicleId}`);

      this.resetCommandBackoff(vehicleId);
      this.clearVehicleError(vehicleId);
      return {
        success: true,
        state: (await this.getState(vehicleId)) ?? undefined,
      };
    } catch (error) {
      this.applyCommandBackoff(vehicleId, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Error tracking ────────────────────────────────────────────────────

  reportVehicleError(
    vehicleId: string,
    vehicleName: string,
    error: string,
    source: "fetch" | "command" = "command",
  ): void {
    this.vehicleErrors.set(vehicleId, {
      message: error,
      at: new Date().toISOString(),
      vehicleName,
      source,
    });
    this.logger.debug(`${vehicleName}: ${source} error reported — ${error}`);
    this.eventEmitter.emit("vehicle_error", {
      vehicleId,
      vehicleName,
      error,
      source,
    });
  }

  clearVehicleError(vehicleId: string): void {
    const stored = this.vehicleErrors.get(vehicleId);
    if (!stored) return;
    this.vehicleErrors.delete(vehicleId);
    this.eventEmitter.emit("vehicle_error", {
      vehicleId,
      vehicleName: stored.vehicleName,
      error: null,
      source: stored.source,
    });
  }

  getVehicleError(
    vehicleId: string,
  ): { message: string; at: string } | null {
    const stored = this.vehicleErrors.get(vehicleId);
    if (!stored) return null;
    return { message: stored.message, at: stored.at };
  }

  /** Check whether commands for this vehicle are backed off due to repeated failures. */
  isBackedOff(vehicleId: string): { backedOff: boolean; remainingMs?: number } {
    const bs = this.commandBackoff.get(vehicleId);
    if (!bs?.backoffUntil) return { backedOff: false };
    const remaining = bs.backoffUntil - Date.now();
    if (remaining <= 0) {
      bs.backoffUntil = null;
      return { backedOff: false };
    }
    return { backedOff: true, remainingMs: remaining };
  }

  // ── SSE subscriptions ─────────────────────────────────────────────────

  subscribeToUpdates(): Observable<VehicleChargeState, unknown> {
    return observable<VehicleChargeState>((emit) => {
      const abort = new AbortController();
      this.getAllStates().then((allStates) => {
        if (abort.signal.aborted) return;
        allStates.forEach((state) => emit.next(state));
      }).catch((err) => {
        this.logger.error("Failed to emit initial states to subscriber:", err);
      });

      const unsubscribe = this.eventEmitter.subscribe(
        "vehicle_update",
        (data) => {
          emit.next(data);
        },
      );

      return () => {
        abort.abort();
        unsubscribe();
      };
    });
  }

  subscribeToErrors(): Observable<EventMap["vehicle_error"], unknown> {
    return observable<EventMap["vehicle_error"]>((emit) => {
      this.vehicleErrors.forEach((error, vehicleId) => {
        emit.next({
          vehicleId,
          vehicleName: error.vehicleName,
          error: error.message,
          source: error.source,
        });
      });

      const unsubscribe = this.eventEmitter.subscribe(
        "vehicle_error",
        (data) => {
          emit.next(data);
        },
      );

      return unsubscribe;
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  getVehicleIds(): string[] {
    return [...this.vehicles.keys()];
  }

  hasVehicle(id: string): boolean {
    return this.vehicles.has(id);
  }

  // ── Private ───────────────────────────────────────────────────────────

  private detectTransitions(
    vehicleId: string,
    newState: VehicleChargeState,
  ): void {
    const tracker = this.plugTrackers.get(vehicleId);
    if (!tracker) return;

    // First data for this vehicle — observe without firing events
    // to avoid false alerts on server restart.
    if (!tracker.initialized) {
      tracker.initialized = true;
      tracker.wasPluggedIn = newState.isPluggedIn;
      tracker.wasHome = newState.isHome;
      return;
    }

    // Plug transition
    if (newState.isPluggedIn !== tracker.wasPluggedIn) {
      this.eventEmitter.emit("vehicle_plug_changed", {
        vehicleId,
        vehicleName: newState.vehicleName,
        isPluggedIn: newState.isPluggedIn,
        isHome: newState.isHome,
      });
      tracker.wasPluggedIn = newState.isPluggedIn;
    }

    // Arrived-home transition: false → true.
    // Strict equality (not !wasHome) — null (location unknown) does not count
    // as "away", so null → true is not treated as an arrival.
    if (tracker.wasHome === false && newState.isHome === true) {
      this.eventEmitter.emit("vehicle_arrived_home", {
        vehicleId,
        vehicleName: newState.vehicleName,
        isPluggedIn: newState.isPluggedIn,
        soc: newState.batteryLevel,
        chargeLimit: newState.chargeLimit,
      });
    }
    tracker.wasHome = newState.isHome;
  }

  private async resetModeOnUnplug(
    vehicleId: string,
    vehicleName: string,
  ): Promise<void> {
    try {
      const vehicle = await this.db.getVehicle(vehicleId);
      if (vehicle?.mode === "charge_now" || vehicle?.mode === "stop") {
        await this.db.updateVehicleMode(vehicleId, "auto");
        this.logger.info(
          `${vehicleName} unplugged — reset mode from ${vehicle.mode} to auto`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to reset mode for ${vehicleName}:`,
        error,
      );
    }
  }

  /** Apply exponential backoff after a command failure and report the error. */
  private applyCommandBackoff(vehicleId: string, error: unknown): void {
    const existing = this.commandBackoff.get(vehicleId);
    const bs = existing ?? { failures: 0, backoffUntil: null };
    if (!existing) this.commandBackoff.set(vehicleId, bs);
    bs.failures++;
    const backoffSec = Math.min(
      MAX_COMMAND_BACKOFF_SEC,
      30 * Math.pow(2, bs.failures - 1),
    );
    bs.backoffUntil = Date.now() + backoffSec * 1000;

    const errorMsg = error instanceof Error ? error.message : String(error);
    const cached = this.vehicles.get(vehicleId)?.middleware.getCachedState();
    const vehicleName = cached?.vehicleName ?? vehicleId;
    this.reportVehicleError(vehicleId, vehicleName, errorMsg, "command");
    this.logger.error(
      `Command failed for ${vehicleId} (backoff ${backoffSec}s):`,
      error,
    );
  }

  /** Reset command backoff after a successful command. */
  private resetCommandBackoff(vehicleId: string): void {
    const bs = this.commandBackoff.get(vehicleId);
    if (bs) {
      bs.failures = 0;
      bs.backoffUntil = null;
    }
  }
}
