import type {
  CallContext,
  ChargerState,
  ChargingPointMode,
} from "@chargeha/shared";
import { SolarAllocator } from "@chargeha/shared/engine";
import { linkedChargingPointId } from "@chargeha/shared/chargingPoints";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow } from "../db/types.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { Logger } from "../lib/Logger.ts";
import type { ChargerMiddleware, ChargerPlugin } from "@chargeha/plugins/types";
import type { ChargerPluginRegistry } from "../bootstrap/ChargerPluginRegistry.ts";

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
    if (this.chargers.has(row.id)) return;
    const plugin = this.chargerPlugins.get(row.chargerAdapterType);
    if (!plugin) {
      this.logger.warn(
        `No charger plugin for type "${row.chargerAdapterType}", skipping ${row.id}`,
      );
      return;
    }
    // A misconfigured charger must not crash boot; retried on config change.
    const middleware = await this.tryCreateMiddleware(plugin, row);
    if (!middleware) return;
    this.chargers.set(row.id, {
      row,
      middleware,
      lastEmittedAt: null,
      lastPluggedIn: null,
    });
    this.logger.info(`Charger registered: ${row.name} (${row.id})`);
    this.eventEmitter.emit("chargers_changed", {});
  }

  private async tryCreateMiddleware(
    plugin: ChargerPlugin,
    row: ChargerRow,
  ): Promise<ChargerMiddleware | null> {
    try {
      return await plugin.createChargerMiddleware(row);
    } catch (error) {
      this.logger.warn(
        `Charger ${row.name} (${row.id}) not started: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
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
    // Last smart charger gone → control returns to the vehicle API.
    const remaining = await this.db.getChargers();
    if (!remaining.some((r) => r.vehicleId === null)) {
      await this.migrateVehiclesToChargers();
      const rows = await this.db.getChargers();
      await rows
        .filter((row) => !this.chargers.has(row.id))
        .reduce(
          (chain, row) => chain.then(() => this.addCharger(row)),
          Promise.resolve(),
        );
    }
    this.eventEmitter.emit("chargers_changed", {});
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
    await this.migrateVehiclesToChargers();
    const solar = await this.configService.getSolar();
    this.cachedGridVoltage = solar.gridVoltage;
    this.eventEmitter.subscribe("config_changed", async ({ key }) => {
      const updated = await this.configService.getSolar();
      this.cachedGridVoltage = updated.gridVoltage;
      // Charger plugin keys arrive prefixed "<pluginId>."
      const pluginId = key.split(".")[0];
      if (this.chargerPlugins.get(pluginId)) {
        await this.rebuildMiddlewaresFor(pluginId);
      }
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

  async syncVehicleChargingPoints(): Promise<void> {
    await this.migrateVehiclesToChargers();
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
    const fresh = await this.db.getChargers();
    await fresh
      .filter((row) => !this.chargers.has(row.id))
      .reduce(
        (chain, row) => chain.then(() => this.addCharger(row)),
        Promise.resolve(),
      );
  }

  // Idempotent: linked rows only for charger-role plugins, never while a
  // standalone smart charger owns control.
  private async migrateVehiclesToChargers(): Promise<void> {
    const [vehicles, chargers] = await Promise.all([
      this.db.getVehicles(),
      this.db.getChargers(),
    ]);
    const hasSmartCharger = chargers.some((c) => c.vehicleId === null);
    if (hasSmartCharger) return;
    const covered = new Set(
      chargers.map((c) => c.vehicleId).filter((id) => id !== null),
    );
    const missing = vehicles.filter((v) =>
      !covered.has(v.id) &&
      this.chargerPlugins.get(v.adapterType) !== undefined
    );
    await missing.reduce(
      (chain, v) =>
        chain.then(async () => {
          await this.db.upsertCharger({
            id: linkedChargingPointId(v.id),
            name: v.name,
            chargerAdapterType: v.adapterType,
            mode: v.mode,
            priority: v.priority,
            vehicleId: v.id,
            kind: "vehicle_api",
            active: true,
          });
          this.logger.info(`Migrated vehicle ${v.name} to a charging point`);
        }),
      Promise.resolve(),
    );
  }

  private async rebuildMiddlewaresFor(pluginId: string): Promise<void> {
    const plugin = this.chargerPlugins.get(pluginId);
    if (!plugin) return;
    const entries = [...this.chargers.values()]
      .filter((e) => e.row.chargerAdapterType === pluginId);
    await entries.reduce(
      (chain, entry) =>
        chain.then(async () => {
          await entry.middleware.shutdown();
          entry.middleware = await plugin.createChargerMiddleware(entry.row);
          this.logger.info(`Rebuilt middleware for ${entry.row.id}`);
        }),
      Promise.resolve(),
    );
    const rows = await this.db.getChargers();
    await rows
      .filter((row) =>
        row.chargerAdapterType === pluginId && !this.chargers.has(row.id)
      )
      .reduce(
        (chain, row) => chain.then(() => this.addCharger(row)),
        Promise.resolve(),
      );
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

    const pluggedIn = [...(await this.vehicleManager.getAllStates())]
      .filter(([, v]) => v.isPluggedIn);
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
    const hadSmartCharger = rows.some((r) => r.vehicleId === null);
    if (!hadSmartCharger) await this.retireVehicleApiRows(rows);
    return row;
  }

  private async retireVehicleApiRows(rows: ChargerRow[]): Promise<void> {
    const linked = rows.filter((r) => r.vehicleId !== null);
    await linked.reduce(
      (chain, r) =>
        chain.then(async () => {
          const entry = this.chargers.get(r.id);
          if (entry) {
            await entry.middleware.shutdown();
            this.chargers.delete(r.id);
          }
          await this.db.deleteCharger(r.id);
          this.logger.info(
            `Control path switched: retired vehicle-API charging point ${r.name}`,
          );
        }),
      Promise.resolve(),
    );
    if (linked.length > 0) {
      await this.db.resequenceChargerPriorities();
      this.eventEmitter.emit("chargers_changed", {});
    }
  }

  async ensureCharger(chargerAdapterType: string): Promise<void> {
    const rows = await this.db.getChargers();
    if (rows.some((row) => row.chargerAdapterType === chargerAdapterType)) {
      return;
    }
    const plugin = this.chargerPlugins.get(chargerAdapterType);
    await this.createCharger({
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
