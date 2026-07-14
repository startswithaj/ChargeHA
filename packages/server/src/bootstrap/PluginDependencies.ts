import type { AppDatabase } from "../db/AppDatabase.ts";
import type { UpsertVehicleInput, VehicleRow } from "../db/types.ts";
import type { VehicleManager } from "../services/VehicleManager.ts";
import type { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import { createLogger, Logger } from "../lib/Logger.ts";
import { PluginDbLogger } from "@chargeha/plugins/PluginDbLogger";

/**
 * Scoped dependencies injected into a plugin at construction time.
 *
 * One instance per plugin. Built via the static `create` factory so the
 * constructor stays private — callers can't forget to wire the plugin id.
 *
 * All config/secret keys are auto-prefixed with `{pluginId}.`, and
 * `getVehicleRows()` returns only vehicles matching the plugin's adapter type.
 * Logs and dbLog entries are tagged with the plugin id.
 *
 * Encryption is a storage concern — `AppDatabase` owns the key and the
 * encrypt/decrypt pathway. Plugins just call `setSecret` / `getSecret` here.
 */
export class PluginDependencies<K extends string = string> {
  readonly pluginId: string;
  readonly log: Logger;
  readonly dbLog: PluginDbLogger;
  private readonly prefix: string;

  static create(
    db: AppDatabase,
    vehicleManager: VehicleManager,
    energyManager: EnergyAdapterManager,
    getTunnelUrl: () => string | null,
    pluginId: string,
  ): PluginDependencies {
    return new PluginDependencies(
      db,
      vehicleManager,
      energyManager,
      getTunnelUrl,
      pluginId,
    );
  }

  private constructor(
    private readonly db: AppDatabase,
    private readonly vehicleManager: VehicleManager,
    private readonly energyManager: EnergyAdapterManager,
    /** Live tunnel URL, or null when the tunnel is down. Never persisted —
     *  quick-tunnel URLs change on every start. */
    readonly getTunnelUrl: () => string | null,
    pluginId: string,
  ) {
    this.pluginId = pluginId;
    this.prefix = `${pluginId}.`;
    this.log = createLogger(`plugin:${pluginId}`);
    this.dbLog = new PluginDbLogger(
      (entry) =>
        this.db.insertPluginLog({
          pluginId,
          level: entry.level,
          message: entry.message,
          payload: entry.payload,
          origin: entry.origin,
          traceId: entry.traceId,
        }),
      createLogger(`plugin:${pluginId}:dblog`),
    );
  }

  // ── Config / secret (auto-namespaced with `${pluginId}.` prefix) ─────

  getConfig(key: K): Promise<string | null> {
    return this.db.getPluginConfig(`${this.prefix}${key}`);
  }

  setConfig(key: K, value: string): Promise<void> {
    return this.db.setPluginConfig(`${this.prefix}${key}`, value);
  }

  getSecret(key: K): Promise<string | null> {
    return this.db.readSecret(`${this.prefix}${key}`);
  }

  setSecret(key: K, value: string): Promise<void> {
    return this.db.storeSecret(`${this.prefix}${key}`, value);
  }

  // ── Vehicle rows (filtered to this plugin's adapter type) ────────────

  async getVehicleRows(): Promise<VehicleRow[]> {
    const all = await this.db.getVehicles();
    return all.filter((v) => v.adapterType === this.pluginId);
  }

  getVehicleRow(id: string): Promise<VehicleRow | null> {
    return this.db.getVehicle(id);
  }

  upsertVehicleRow(input: UpsertVehicleInput): Promise<void> {
    return this.db.upsertVehicle(input);
  }

  // ── Vehicle lifecycle (notify VehicleManager) ────────────────────────

  addVehicle(row: VehicleRow): Promise<void> {
    return this.vehicleManager.addVehicle(row);
  }

  /** Permanently delete a vehicle: drops live state, deletes the row
   *  (cascading its schedules), and renumbers remaining priorities. */
  deleteVehicle(id: string): Promise<void> {
    return this.vehicleManager.deleteVehicle(id);
  }

  // ── Simulated load (Simulated plugin only) ───────────────────────────

  /** Report simulated charging load so EnergyAdapterManager can reflect
   *  it in realtime readings. Only the Simulated vehicle plugin uses this. */
  setSimulatedLoad(watts: number): void {
    this.energyManager.setSimulatedLoad(watts);
  }
}
