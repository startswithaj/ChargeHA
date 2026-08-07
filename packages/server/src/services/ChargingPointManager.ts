import type {
  CallContext,
  ChargerState,
  ChargingPointMode,
} from "@chargeha/shared";
import { SolarAllocator } from "@chargeha/shared/engine";
import { linkedChargingPointId } from "@chargeha/shared/chargingPoints";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow, VehicleRow } from "../db/types.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { Logger } from "../lib/Logger.ts";
import type {
  ChargerMiddleware,
  ChargerPlugin,
} from "@chargeha/shared/plugins";
import type { ChargerPluginRegistry } from "../bootstrap/ChargerPluginRegistry.ts";
import { UnconfiguredChargerMiddleware } from "./UnconfiguredChargerMiddleware.ts";

const MAX_COMMAND_BACKOFF_SEC = 900;

interface ChargerEntry {
  row: ChargerRow;
  middleware: ChargerMiddleware;
  lastEmittedAt: string | null;
  lastPluggedIn: boolean | null;
  lastResolved?: string | null;
  // What we last asked for — the engine compares against this, not the
  // measured draw, so a car taking fewer amps never triggers re-commands.
  lastCommandedAmps?: number | null;
}

export interface VehicleResolution {
  kind: "linked" | "inferred" | "ambiguous" | "none";
  vehicleId: string | null;
}

interface CommandBackoffState {
  failures: number;
  backoffUntil: number | null;
}

export class ChargingPointManager {
  private chargers = new Map<string, ChargerEntry>();
  private commandBackoff = new Map<string, CommandBackoffState>();
  // Cached at init; enrich() runs on hot paths and must not hit the DB.
  private cachedGridVoltage: number | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly chargerPlugins: ChargerPluginRegistry,
    private readonly vehicleManager: VehicleManager,
    private readonly poller: EnergyPoller,
    private readonly configService: ConfigService,
    private readonly eventEmitter: TypedEventEmitter,
    private readonly logger: Logger,
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────

  async addCharger(row: ChargerRow): Promise<void> {
    if (this.chargers.has(row.id) || !row.active) return;
    const plugin = this.chargerPlugins.get(row.chargerAdapterType);
    if (!plugin) {
      this.logger.warn(
        `No charger plugin for type "${row.chargerAdapterType}", skipping ${row.id}`,
      );
      return;
    }
    // A misconfigured charger must not crash boot; retried on config change.
    const middleware = await this.tryCreateMiddleware(plugin, row);
    this.chargers.set(row.id, {
      row,
      middleware,
      lastEmittedAt: null,
      lastPluggedIn: null,
    });
    this.logger.info(`Charger registered: ${row.name} (${row.id})`);
    this.eventEmitter.emit("chargers_changed", {});
  }

  /** Never throws: a charger whose adapter cannot be built still registers
   *  and reports "unconfigured", so the dashboard can say what is wrong.
   *
   *  Reading the row's config and secrets happens INSIDE the try. A row whose
   *  secrets were encrypted under an ENCRYPTION_KEY that is no longer set
   *  makes `getChargerSecrets` throw; that must show up as one unconfigured
   *  charger on the dashboard, not as a failed boot. */
  private async tryCreateMiddleware(
    plugin: ChargerPlugin,
    row: ChargerRow,
  ): Promise<ChargerMiddleware> {
    try {
      // The host reads storage so the plugin never has to — see
      // ChargerPlugin.createChargerMiddleware.
      const [config, secrets] = await Promise.all([
        this.db.getChargerConfig(row.id),
        this.db.getChargerSecrets(row.id),
      ]);
      return await plugin.createChargerMiddleware(row, { config, secrets });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Charger ${row.name} (${row.id}) not started: ${message}`,
      );
      return new UnconfiguredChargerMiddleware(row.id, message);
    }
  }

  async deleteCharger(id: string): Promise<void> {
    const entry = this.chargers.get(id);
    if (entry) {
      await entry.middleware.shutdown();
      this.chargers.delete(id);
    }
    await this.db.deleteCharger(id);
    await this.db.resequenceChargerPriorities();
    this.logger.info(`Charger deleted: ${id}`);
    const remaining = await this.db.getChargers();
    if (!remaining.some((r) => r.kind === "smart")) {
      await this.setVehicleApiActive(true);
    }
    this.eventEmitter.emit("chargers_changed", {});
  }

  /** Vehicle-API points are deactivated rather than deleted so that their
   *  schedules, logs and stats survive a control-path switch. */
  private async setVehicleApiActive(active: boolean): Promise<void> {
    const rows = await this.db.getChargers();
    const targets = rows.filter((r) =>
      r.kind === "vehicle_api" && r.active !== active
    );
    await targets.reduce(
      (chain, row) =>
        chain.then(async () => {
          await this.db.updateChargerActive(row.id, active);
          if (active) await this.addCharger({ ...row, active: true });
          else await this.stopAndUnregister(row.id);
          this.logger.info(
            `Charging point ${row.name} ${
              active ? "reactivated" : "deactivated"
            }`,
          );
        }),
      Promise.resolve(),
    );
    if (targets.length > 0) this.eventEmitter.emit("chargers_changed", {});
  }

  // Handing control over must not leave the car drawing under a stale amp
  // command that nothing will revisit.
  private async stopAndUnregister(id: string): Promise<void> {
    const entry = this.chargers.get(id);
    if (!entry) return;
    const state = entry.middleware.getCachedState();
    if (state?.isCharging) {
      await this.stopCharging(
        id,
        { origin: "control-path", traceId: crypto.randomUUID() },
        state,
        { force: true },
      );
    }
    await entry.middleware.shutdown();
    this.chargers.delete(id);
  }

  // ── State ────────────────────────────────────────────────────────────

  async requestState(
    id: string,
    ctx: CallContext,
  ): Promise<ChargerState | null> {
    const entry = this.chargers.get(id);
    if (!entry) return null;
    try {
      const state = this.enrich(await entry.middleware.requestState(ctx));
      if (state && state.lastUpdated !== entry.lastEmittedAt) {
        entry.lastEmittedAt = state.lastUpdated;
        this.eventEmitter.emit("charger_update", {
          ...state,
          chargerName: entry.row.name,
        });
      }
      if (state?.isCharging === false) entry.lastCommandedAmps = null;
      await this.resetModeOnUnplug(id, state, ctx);
      return state;
    } catch (error) {
      this.logger.warn(
        `State fetch failed for ${entry.row.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.enrich(entry.middleware.getCachedState() ?? null);
    }
  }

  // A cable pull ends a charge_now/stop session override.
  private async resetModeOnUnplug(
    id: string,
    state: ChargerState | null,
    ctx: CallContext,
  ): Promise<void> {
    const entry = this.chargers.get(id);
    if (!entry) return;
    const pluggedIn = state?.isPluggedIn ?? null;
    const unplugged = entry.lastPluggedIn === true && pluggedIn === false;
    entry.lastPluggedIn = pluggedIn ?? entry.lastPluggedIn;
    if (!unplugged || entry.row.mode === "auto") return;
    this.logger.info(`Unplugged: resetting ${entry.row.id} to auto`);
    await this.setMode(entry.row.id, "auto", ctx);
  }

  /** A point with no adapter still has a row and a card, but nothing to
   *  drive. Reads the cache directly — enrich() derives amps we never use. */
  isControllable(id: string): boolean {
    const entry = this.chargers.get(id);
    return entry !== undefined &&
      entry.middleware.getCachedState()?.status !== "unconfigured";
  }

  getState(id: string): ChargerState | null {
    const entry = this.chargers.get(id);
    return this.enrich(entry?.middleware.getCachedState() ?? null);
  }

  private enrich(state: ChargerState | null): ChargerState | null {
    if (!state) return null;
    if (state.chargeAmps !== null || state.chargePowerKw === null) return state;
    if (this.cachedGridVoltage === null) return state;

    const energy = this.poller.tryGetRealtimeSnapshot()?.realtime ?? null;
    const voltage = SolarAllocator.resolveVoltage(
      state.chargerVoltage,
      energy,
      this.cachedGridVoltage,
    );
    const watts = state.chargePowerKw * 1000;
    return {
      ...state,
      chargeAmps: Math.round((watts / (voltage * state.chargerPhases)) * 10) /
        10,
    };
  }

  async init(): Promise<void> {
    const solar = await this.configService.getSolar();
    this.cachedGridVoltage = solar.gridVoltage;
    this.eventEmitter.subscribe("config_changed", async () => {
      // The only remaining consumer here: charger config is row-scoped now
      // (see rebuildMiddlewareFor) and this event carries no row id, so it
      // rebuilds nothing charger-related — just the cached grid voltage.
      const updated = await this.configService.getSolar();
      this.cachedGridVoltage = updated.gridVoltage;
    });
    this.eventEmitter.subscribe("vehicles_changed", async () => {
      await this.syncVehicleChargingPoints();
    });
    const rows = await this.db.getChargers();
    await rows.reduce(
      (chain, row) => chain.then(() => this.addCharger(row)),
      Promise.resolve(),
    );
  }

  /** Drops charging points whose vehicle no longer exists. Creating points
   *  for new vehicles is the vehicle-creation path's job, not an event's. */
  async syncVehicleChargingPoints(): Promise<void> {
    const [vehicles, rows] = await Promise.all([
      this.db.getVehicles(),
      this.db.getChargers(),
    ]);
    const vehicleIds = new Set(vehicles.map((v) => v.id));
    const orphans = rows.filter((r) =>
      r.vehicleId !== null && !vehicleIds.has(r.vehicleId)
    );
    await orphans.reduce(
      (chain, r) => chain.then(() => this.deleteCharger(r.id)),
      Promise.resolve(),
    );
  }

  /** Gives a newly added vehicle its own charging point, unless a smart
   *  charger already owns control or its plugin has no charger role. */
  async ensureVehicleChargingPoint(vehicle: VehicleRow): Promise<void> {
    if (!this.chargerPlugins.get(vehicle.adapterType)) return;
    const rows = await this.db.getChargers();
    if (rows.some((r) => r.kind === "smart")) return;
    const id = linkedChargingPointId(vehicle.id);
    if (rows.some((r) => r.id === id)) return;
    const now = new Date().toISOString();
    const row: ChargerRow = {
      id,
      name: vehicle.name,
      chargerAdapterType: vehicle.adapterType,
      chargerConfig: "{}",
      mode: vehicle.mode,
      priority: vehicle.priority,
      vehicleId: vehicle.id,
      kind: "vehicle_api",
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.upsertCharger(row);
    await this.addCharger(row);
    this.logger.info(`Charging point created for vehicle ${vehicle.name}`);
  }

  /** Per-vehicle control-path switch: whether this car is driven by its own
   *  API or by whichever smart charger it is plugged into. */
  async setVehicleApiControl(
    vehicleId: string,
    active: boolean,
  ): Promise<void> {
    const rows = await this.db.getChargers();
    const row = rows.find((r) =>
      r.kind === "vehicle_api" && r.vehicleId === vehicleId
    );
    if (!row || row.active === active) return;
    await this.db.updateChargerActive(row.id, active);
    if (active) await this.addCharger({ ...row, active: true });
    else await this.stopAndUnregister(row.id);
    this.eventEmitter.emit("chargers_changed", {});
  }

  /** Rebuild the running middleware for ONE charger row after a row-scoped
   *  config write. Never throws: a still-wrong config becomes an
   *  UnconfiguredChargerMiddleware, so a bad Save still resolves. Registers
   *  the row if it is not yet in the map — the first save on a fresh
   *  charger — and clears `lastCommandedAmps`, since amps commanded against
   *  the old adapter mean nothing against the new one. */
  async rebuildMiddlewareFor(chargerRowId: string): Promise<void> {
    const entry = this.chargers.get(chargerRowId);
    if (entry === undefined) {
      const rows = await this.db.getChargers();
      const row = rows.find((r) => r.id === chargerRowId);
      if (row) await this.addCharger(row);
      return;
    }
    const plugin = this.chargerPlugins.get(entry.row.chargerAdapterType);
    if (!plugin) return;
    await entry.middleware.shutdown();
    entry.lastCommandedAmps = null;
    entry.middleware = await this.tryCreateMiddleware(plugin, entry.row);
    this.logger.info(`Rebuilt middleware for ${entry.row.id}`);
    this.eventEmitter.emit("chargers_changed", {});
  }

  // ── Commands ─────────────────────────────────────────────────────────

  async startChargingAt(
    id: string,
    amps: number,
    ctx: CallContext,
    state: ChargerState,
    { force = false } = {},
  ): Promise<{ success: boolean; error?: string }> {
    const entry = this.chargers.get(id);
    if (!entry) return { success: false, error: "Charger not registered" };
    if (this.isBackedOff(id).backedOff && !force) {
      return { success: false, error: "Command backoff active" };
    }
    try {
      const info = await entry.middleware.getChargerInfo(ctx);
      const clamped = Math.max(
        state.chargeAmpsMin,
        Math.min(state.chargeAmpsMax, Math.round(amps)),
      );
      // Switch chargers never receive amp commands.
      const alreadyCommanded = entry.lastCommandedAmps === clamped &&
        state.isCharging;
      if (
        info.controlMode === "amps" && !alreadyCommanded &&
        state.chargeAmps !== clamped
      ) {
        const ok = await entry.middleware.setChargeAmps(
          clamped,
          { ...ctx, origin: `${ctx.origin}:set-amps` },
        );
        if (!ok) throw new Error(`setChargeAmps(${clamped}) rejected`);
      }
      entry.lastCommandedAmps = clamped;
      if (!state.isCharging) {
        const ok = await entry.middleware.startCharging(
          { ...ctx, origin: `${ctx.origin}:start` },
        );
        if (!ok) throw new Error("startCharging rejected");
        this.logger.info(`Started ${id} at ${clamped}A`);
      }
      this.resetCommandBackoff(id);
      return { success: true };
    } catch (error) {
      this.applyCommandBackoff(id, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async stopCharging(
    id: string,
    ctx: CallContext,
    state: ChargerState,
    { force = false } = {},
  ): Promise<{ success: boolean; error?: string }> {
    const entry = this.chargers.get(id);
    if (!entry) return { success: false, error: "Charger not registered" };
    if (!state.isCharging) return { success: true };
    if (this.isBackedOff(id).backedOff && !force) {
      return { success: false, error: "Command backoff active" };
    }
    try {
      const ok = await entry.middleware.stopCharging(
        { ...ctx, origin: `${ctx.origin}:stop` },
      );
      if (!ok) throw new Error("stopCharging rejected");
      entry.lastCommandedAmps = null;
      this.logger.info(`Stopped ${id}`);
      this.resetCommandBackoff(id);
      return { success: true };
    } catch (error) {
      this.applyCommandBackoff(id, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Vehicle resolution ───────────────────────────────────────────────

  async resolveVehicleId(id: string): Promise<string | null> {
    return (await this.resolveVehicle(id)).vehicleId;
  }

  // Inference never guesses: exactly one plugged-in vehicle resolves
  // (charging or not); several plugged in is ambiguous.
  async resolveVehicle(id: string): Promise<VehicleResolution> {
    const entry = this.chargers.get(id);
    if (!entry) return { kind: "none", vehicleId: null };
    if (entry.row.vehicleId) {
      return { kind: "linked", vehicleId: entry.row.vehicleId };
    }

    // A car driven by its own API is not a candidate for this charger, and
    // one that is away cannot be plugged into it. isHome is null when
    // unknown, so only an explicit false rules a vehicle out.
    const selfDriven = new Set(
      (await this.db.getChargers())
        .filter((r) => r.kind === "vehicle_api" && r.active)
        .map((r) => r.vehicleId),
    );
    const pluggedIn = [...(await this.vehicleManager.getAllStates())]
      .filter(([vehicleId, v]) =>
        v.isPluggedIn && v.isHome !== false && !selfDriven.has(vehicleId)
      );
    const resolution: VehicleResolution = pluggedIn.length === 1
      ? { kind: "inferred", vehicleId: pluggedIn[0][0] }
      : { kind: pluggedIn.length > 1 ? "ambiguous" : "none", vehicleId: null };
    if (entry.lastResolved !== resolution.vehicleId) {
      entry.lastResolved = resolution.vehicleId;
      this.logger.info(
        `Charger ${id}: vehicle resolution ${resolution.kind}` +
          (resolution.vehicleId ? ` (${resolution.vehicleId})` : ""),
      );
    }
    return resolution;
  }

  // ── Mode / priority / CRUD (called from chargersRouter) ──────────────

  async setMode(
    id: string,
    mode: ChargingPointMode,
    ctx: CallContext,
  ): Promise<void> {
    await this.db.updateChargerMode(id, mode);
    const entry = this.chargers.get(id);
    if (entry) entry.row = { ...entry.row, mode };
    this.eventEmitter.emit("chargers_changed", {});

    const state = this.getState(id);
    if (!state) return;
    if (mode === "charge_now") {
      await this.startChargingAt(id, state.chargeAmpsMax, ctx, state, {
        force: true,
      });
    }
    if (mode === "stop") {
      await this.stopCharging(id, ctx, state, { force: true });
    }
  }

  async reorder(order: string[]): Promise<void> {
    await Promise.all(
      order.map((id, i) => this.db.updateChargerPriority(id, i + 1)),
    );
    this.eventEmitter.emit("chargers_changed", {});
  }

  async createCharger(
    input: { name: string; chargerAdapterType: string },
  ): Promise<ChargerRow> {
    const rows = await this.db.getChargers();
    const row: ChargerRow = {
      id: crypto.randomUUID(),
      name: input.name,
      chargerAdapterType: input.chargerAdapterType,
      chargerConfig: "{}",
      mode: "auto",
      priority: rows.length + 1,
      vehicleId: null,
      kind: "smart",
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.db.upsertCharger(row);
    await this.addCharger(row);
    // One control path per car: the first smart charger takes over.
    if (!rows.some((r) => r.kind === "smart")) {
      await this.setVehicleApiActive(false);
    }
    return row;
  }

  async ensureCharger(chargerAdapterType: string): Promise<ChargerRow> {
    const rows = await this.db.getChargers();
    const existing = rows.find((row) =>
      row.chargerAdapterType === chargerAdapterType
    );
    if (existing) return existing;
    const plugin = this.chargerPlugins.get(chargerAdapterType);
    return await this.createCharger({
      name: plugin?.displayName ?? chargerAdapterType,
      chargerAdapterType,
    });
  }

  async getChargersWithState() {
    const rows = await this.db.getChargers();
    return await Promise.all(rows.map(async (row) => {
      const resolution = await this.resolveVehicle(row.id);
      return {
        ...row,
        state: this.getState(row.id),
        resolvedVehicleId: resolution.vehicleId,
        vehicleResolution: resolution.kind,
      };
    }));
  }

  // ── Backoff ──────────────────────────────────────────────────────────

  isBackedOff(id: string): { backedOff: boolean; remainingMs: number } {
    const bs = this.commandBackoff.get(id);
    if (!bs?.backoffUntil) return { backedOff: false, remainingMs: 0 };
    const remainingMs = bs.backoffUntil - Date.now();
    if (remainingMs <= 0) {
      bs.backoffUntil = null;
      return { backedOff: false, remainingMs: 0 };
    }
    return { backedOff: true, remainingMs };
  }

  private applyCommandBackoff(id: string, error: unknown): void {
    const existing = this.commandBackoff.get(id);
    const bs = existing ?? { failures: 0, backoffUntil: null };
    if (!existing) this.commandBackoff.set(id, bs);
    bs.failures++;
    const backoffSec = Math.min(
      MAX_COMMAND_BACKOFF_SEC,
      30 * Math.pow(2, bs.failures - 1),
    );
    bs.backoffUntil = Date.now() + backoffSec * 1000;
    this.logger.error(
      `Command failed for ${id} (backoff ${backoffSec}s):`,
      error,
    );
  }

  private resetCommandBackoff(id: string): void {
    const bs = this.commandBackoff.get(id);
    if (bs) {
      bs.failures = 0;
      bs.backoffUntil = null;
    }
  }
}
