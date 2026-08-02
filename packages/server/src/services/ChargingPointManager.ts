import type {
  CallContext,
  ChargerState,
  ChargingPointMode,
} from "@chargeha/shared";
import { SolarAllocator } from "@chargeha/shared/engine";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { ChargerRow } from "../db/types.ts";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { EnergyPoller } from "./EnergyPoller.ts";
import type { ConfigService } from "./ConfigService.ts";
import type { Logger } from "../lib/Logger.ts";
import type { ChargerMiddleware } from "@chargeha/plugins/types";
import type { ChargerPluginRegistry } from "../bootstrap/ChargerPluginRegistry.ts";

const MAX_COMMAND_BACKOFF_SEC = 900;

interface ChargerEntry {
  row: ChargerRow;
  middleware: ChargerMiddleware;
  lastEmittedAt: string | null;
}

interface CommandBackoffState {
  failures: number;
  backoffUntil: number | null;
}

export class ChargingPointManager {
  private chargers = new Map<string, ChargerEntry>();
  private commandBackoff = new Map<string, CommandBackoffState>();
  /** Loaded by init(); null until then — enrich() derives nothing without
   *  a real configured voltage. Cached because enrich() runs on hot paths
   *  and must not hit the DB per read. */
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
    const middleware = await plugin.createChargerMiddleware(row);
    this.chargers.set(row.id, { row, middleware, lastEmittedAt: null });
    this.logger.info(`Charger registered: ${row.name} (${row.id})`);
    this.eventEmitter.emit("chargers_changed", {});
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
    this.eventEmitter.emit("chargers_changed", {});
  }

  // ── State ────────────────────────────────────────────────────────────

  async requestState(
    id: string,
    ctx: CallContext,
  ): Promise<ChargerState | null> {
    const entry = this.chargers.get(id);
    if (!entry) return null;
    const state = this.enrich(await entry.middleware.requestState(ctx));
    if (state && state.lastUpdated !== entry.lastEmittedAt) {
      entry.lastEmittedAt = state.lastUpdated;
      this.eventEmitter.emit("charger_update", {
        ...state,
        chargerName: entry.row.name,
      });
    }
    return state;
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
    this.eventEmitter.subscribe("config_changed", async ({ key }) => {
      const updated = await this.configService.getSolar();
      this.cachedGridVoltage = updated.gridVoltage;
      // Charger plugin keys arrive prefixed "<pluginId>."
      const pluginId = key.split(".")[0];
      if (this.chargerPlugins.get(pluginId)) {
        await this.rebuildMiddlewaresFor(pluginId);
      }
    });
    const rows = await this.db.getChargers();
    await rows.reduce(
      (chain, row) => chain.then(() => this.addCharger(row)),
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
    if (this.isBackedOff(id) && !force) {
      return { success: false, error: "Command backoff active" };
    }

    try {
      const info = await entry.middleware.getChargerInfo(ctx);
      const clamped = Math.max(
        state.chargeAmpsMin,
        Math.min(state.chargeAmpsMax, Math.round(amps)),
      );
      // Switch chargers never receive amp commands — measured-amp jitter
      // must not trigger setChargeAmps.
      if (info.controlMode === "amps" && state.chargeAmps !== clamped) {
        const ok = await entry.middleware.setChargeAmps(
          clamped,
          { ...ctx, origin: `${ctx.origin}:set-amps` },
        );
        if (!ok) throw new Error(`setChargeAmps(${clamped}) rejected`);
      }
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
    if (this.isBackedOff(id) && !force) {
      return { success: false, error: "Command backoff active" };
    }
    try {
      const ok = await entry.middleware.stopCharging(
        { ...ctx, origin: `${ctx.origin}:stop` },
      );
      if (!ok) throw new Error("stopCharging rejected");
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
    const entry = this.chargers.get(id);
    if (!entry) return null;
    if (entry.row.vehicleId) return entry.row.vehicleId;

    const state = this.getState(id);
    if (!state?.isCharging) return null;
    const pluggedIn = [...(await this.vehicleManager.getAllStates())]
      .filter(([, v]) => v.isPluggedIn);
    if (pluggedIn.length !== 1) {
      if (pluggedIn.length > 1) {
        this.logger.info(
          `Charger ${id}: ${pluggedIn.length} vehicles plugged in — not guessing`,
        );
      }
      return null;
    }
    this.logger.info(`Charger ${id}: inferred vehicle ${pluggedIn[0][0]}`);
    return pluggedIn[0][0];
  }

  // ── Mode / priority / CRUD (called from chargersRouter) ──────────────

  async setMode(
    id: string,
    mode: ChargingPointMode,
    _ctx: CallContext,
  ): Promise<void> {
    await this.db.updateChargerMode(id, mode);
    const entry = this.chargers.get(id);
    if (entry) entry.row = { ...entry.row, mode };
    this.eventEmitter.emit("chargers_changed", {});
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.db.upsertCharger(row);
    await this.addCharger(row);
    return row;
  }

  /** Create the charger row for a plugin type if none exists — the host
   *  calls this when a charger plugin's setup completes (wizard or
   *  Settings); plugin code never creates core rows itself. */
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
    return rows.map((row) => ({
      ...row,
      state: this.getState(row.id),
    }));
  }

  // ── Backoff (same pattern as VehicleManager) ─────────────────────────

  private isBackedOff(id: string): boolean {
    const bs = this.commandBackoff.get(id);
    if (!bs?.backoffUntil) return false;
    if (bs.backoffUntil <= Date.now()) {
      bs.backoffUntil = null;
      return false;
    }
    return true;
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
