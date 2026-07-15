import type { GeocodeResult } from "@chargeha/shared/geocode";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { UpsertVehicleInput, VehicleRow } from "../db/types.ts";
import type { VehicleManager } from "../services/VehicleManager.ts";
import type { VehicleChargeState } from "@chargeha/shared";
import type { VehicleRequestContext } from "@chargeha/plugins/types";
import type { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import {
  enrichVehicleRows,
  type VehicleWithLiveState,
} from "../services/VehicleService.ts";
import { createLogger, Logger } from "../lib/Logger.ts";
import { PluginDbLogger } from "@chargeha/plugins/PluginDbLogger";

/** Tunnel lifecycle exposed to plugins. URLs are live state, never persisted
 *  — quick-tunnel URLs change on every start. */
export interface PluginTunnelApi {
  getUrl(): string | null;
  start(): Promise<{ url: string }>;
  stop(): Promise<void>;
  /** Free-tier session limit of the tunnel provider, if any. */
  getExpiryMinutes(): number | null;
}

/** Everything a PluginDependencies instance is built from. */
export interface PluginDependenciesInit {
  db: AppDatabase;
  vehicleManager: VehicleManager;
  energyManager: EnergyAdapterManager;
  tunnel: PluginTunnelApi;
  geocode: (query: string) => Promise<GeocodeResult>;
  /** Whether ENCRYPTION_KEY is configured — secrets are stored encrypted. */
  encryptionConfigured: () => boolean;
  pluginId: string;
}

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
  readonly tunnel: PluginTunnelApi;
  readonly geocode: (query: string) => Promise<GeocodeResult>;
  /** Whether ENCRYPTION_KEY is configured — secrets are stored encrypted. */
  readonly encryptionConfigured: () => boolean;
  private readonly db: AppDatabase;
  private readonly vehicleManager: VehicleManager;
  private readonly energyManager: EnergyAdapterManager;
  private readonly prefix: string;

  static create(init: PluginDependenciesInit): PluginDependencies {
    return new PluginDependencies(init);
  }

  private constructor(init: PluginDependenciesInit) {
    this.db = init.db;
    this.vehicleManager = init.vehicleManager;
    this.energyManager = init.energyManager;
    this.tunnel = init.tunnel;
    this.geocode = init.geocode;
    this.encryptionConfigured = init.encryptionConfigured;
    this.pluginId = init.pluginId;
    this.prefix = `${init.pluginId}.`;
    this.log = createLogger(`plugin:${init.pluginId}`);
    this.dbLog = new PluginDbLogger(
      (entry) =>
        this.db.insertPluginLog({
          pluginId: init.pluginId,
          level: entry.level,
          message: entry.message,
          payload: entry.payload,
          origin: entry.origin,
          traceId: entry.traceId,
        }),
      createLogger(`plugin:${init.pluginId}:dblog`),
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

  /** This plugin's vehicles enriched with live state, location, and last
   *  error — the same shape the main app's vehicle list uses. */
  async getVehiclesWithState(): Promise<VehicleWithLiveState[]> {
    return await enrichVehicleRows(
      await this.getVehicleRows(),
      this.vehicleManager,
    );
  }

  /** Request fresh state for one of this plugin's vehicles. Rejects ids
   *  belonging to other plugins. */
  async requestVehicleState(
    vehicleId: string,
    context: VehicleRequestContext,
  ): Promise<VehicleChargeState | null> {
    const row = await this.db.getVehicle(vehicleId);
    if (!row || row.adapterType !== this.pluginId) {
      throw new Error(
        `Vehicle ${vehicleId} does not belong to plugin ${this.pluginId}`,
      );
    }
    return await this.vehicleManager.requestState(vehicleId, context);
  }

  /** One of this plugin's vehicle rows, or null when the id doesn't exist
   *  or belongs to another plugin. */
  async getVehicleRow(id: string): Promise<VehicleRow | null> {
    const row = await this.db.getVehicle(id);
    return row?.adapterType === this.pluginId ? row : null;
  }

  /** Upsert a vehicle for this plugin. The adapter type is stamped with the
   *  plugin's own id — a plugin cannot write another plugin's vehicles. */
  upsertVehicleRow(
    input: Omit<UpsertVehicleInput, "adapterType">,
  ): Promise<void> {
    return this.db.upsertVehicle({ ...input, adapterType: this.pluginId });
  }

  // ── Vehicle lifecycle (notify VehicleManager) ────────────────────────

  addVehicle(row: VehicleRow): Promise<void> {
    return this.vehicleManager.addVehicle(row);
  }

  /** Permanently delete one of this plugin's vehicles: drops live state,
   *  deletes the row (cascading its schedules), and renumbers remaining
   *  priorities. Rejects ids belonging to other plugins. */
  async deleteVehicle(id: string): Promise<void> {
    const row = await this.db.getVehicle(id);
    if (!row || row.adapterType !== this.pluginId) {
      throw new Error(
        `Vehicle ${id} does not belong to plugin ${this.pluginId}`,
      );
    }
    await this.vehicleManager.deleteVehicle(id);
  }

  // ── Simulated load (Simulated plugin only) ───────────────────────────

  /** Report simulated charging load so EnergyAdapterManager can reflect
   *  it in realtime readings. Only the Simulated vehicle plugin uses this. */
  setSimulatedLoad(watts: number): void {
    this.energyManager.setSimulatedLoad(watts);
  }
}
