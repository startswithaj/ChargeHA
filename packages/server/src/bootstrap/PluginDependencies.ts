import type { GeocodeResult } from "@chargeha/shared/geocode";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type {
  ChargerRow,
  UpsertVehicleInput,
  VehicleRow,
} from "../db/types.ts";
import type { VehicleManager } from "../services/VehicleManager.ts";
import type { ChargingPointManager } from "../services/ChargingPointManager.ts";
import type { ChargerConfigPatch, VehicleChargeState } from "@chargeha/shared";
import type {
  ChargerRowConfig,
  ResolvedChargerRow,
  VehicleRequestContext,
} from "@chargeha/shared/plugins";
import type { EnergyAdapterManager } from "../services/EnergyAdapterManager.ts";
import {
  enrichVehicleRows,
  type VehicleWithLiveState,
} from "../services/VehicleService.ts";
import { createLogger, Logger } from "../lib/Logger.ts";
import { PluginDbLogger } from "../lib/PluginDbLogger.ts";

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
  chargingPoints: ChargingPointManager;
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
  private readonly chargingPoints: ChargingPointManager;
  private readonly energyManager: EnergyAdapterManager;
  private readonly prefix: string;

  static create(init: PluginDependenciesInit): PluginDependencies {
    return new PluginDependencies(init);
  }

  private constructor(init: PluginDependenciesInit) {
    this.db = init.db;
    this.vehicleManager = init.vehicleManager;
    this.chargingPoints = init.chargingPoints;
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

  setConfig(key: K, value: string | null): Promise<void> {
    return this.db.setPluginConfig(`${this.prefix}${key}`, value);
  }

  getSecret(key: K): Promise<string | null> {
    return this.db.readSecret(`${this.prefix}${key}`);
  }

  setSecret(key: K, value: string | null): Promise<void> {
    return this.db.storeSecret(`${this.prefix}${key}`, value);
  }

  // ── Charger rows + row-scoped config ─────────────────────────────────
  //
  // There is no plugin-wide charger config any more. Every charger value —
  // host, credentials, charge point id, amp limits — belongs to one charger
  // row, so two chargers of one adapter type control two different devices.

  /** This plugin's charger rows. Filtered by adapter type for the same reason
   *  vehicles are: a plugin must never see another plugin's hardware. */
  async getChargerRows(): Promise<ChargerRow[]> {
    const all = await this.db.getChargers();
    return all.filter((c) => c.chargerAdapterType === this.pluginId);
  }

  /** One of this plugin's charger rows, or throws. Same ownership check as
   *  `requestVehicleState` and `deleteVehicle`: a plugin must not be able to
   *  read or write another plugin's credentials by guessing a row id. */
  private async ownedChargerRow(chargerRowId: string): Promise<ChargerRow> {
    const row = await this.db.getCharger(chargerRowId);
    if (!row || row.chargerAdapterType !== this.pluginId) {
      throw new Error(
        `Charger ${chargerRowId} does not belong to plugin ${this.pluginId}`,
      );
    }
    return row;
  }

  /** Row-scoped config plus decrypted secrets for one of this plugin's
   *  chargers. The only route a plugin has to per-charger credentials.
   *
   *  Throws when the row is missing, belongs to another plugin, or its
   *  secrets are encrypted with no ENCRYPTION_KEY set — callers on the
   *  middleware-construction path have that turned into an "unconfigured"
   *  charger by ChargingPointManager. */
  async resolveChargerConfig(chargerRowId: string): Promise<ChargerRowConfig> {
    await this.ownedChargerRow(chargerRowId);
    const [config, secrets] = await Promise.all([
      this.db.getChargerConfig(chargerRowId),
      this.db.getChargerSecrets(chargerRowId),
    ]);
    return { config, secrets };
  }

  /** Every charger row of this plugin with its config and secrets resolved.
   *
   *  Health checks, OCPP pairing and the OCPP websocket route all have to work
   *  across every charger of the type rather than one privileged instance;
   *  this is the shape that question needs. Ownership is guaranteed by
   *  `getChargerRows`, so no per-row re-check is done. */
  async resolveChargerConfigs(): Promise<ResolvedChargerRow[]> {
    const rows = await this.getChargerRows();
    return await Promise.all(rows.map(async (row) => {
      const [config, secrets] = await Promise.all([
        this.db.getChargerConfig(row.id),
        this.db.getChargerSecrets(row.id),
      ]);
      return { row, config, secrets };
    }));
  }

  /** Set or remove non-secret keys on one of this plugin's charger rows.
   *  `null` deletes the key rather than storing "" (code.md). Untouched keys
   *  are preserved. */
  async patchChargerConfig(
    chargerRowId: string,
    patch: ChargerConfigPatch,
  ): Promise<void> {
    await this.ownedChargerRow(chargerRowId);
    await this.db.patchChargerConfig(chargerRowId, patch);
  }

  /** Set or remove secret keys on one of this plugin's charger rows.
   *  Encryption is a storage concern — AppDatabase owns the key and this
   *  method takes and returns plaintext, exactly like `setSecret` does for
   *  plugin-wide values. */
  async patchChargerSecrets(
    chargerRowId: string,
    patch: ChargerConfigPatch,
  ): Promise<void> {
    await this.ownedChargerRow(chargerRowId);
    await this.db.patchChargerSecrets(chargerRowId, patch);
  }

  /** Rebuild the running middleware for one of this plugin's chargers, after
   *  a row-scoped config write. Ownership-guarded like every other charger
   *  method — a plugin cannot rebuild another plugin's charger. */
  async rebuildCharger(chargerRowId: string): Promise<void> {
    await this.ownedChargerRow(chargerRowId);
    await this.chargingPoints.rebuildMiddlewareFor(chargerRowId);
  }

  /** Create a new charger row for this plugin. The adapter type is stamped
   *  with the plugin's own id — a plugin cannot create another plugin's
   *  charger. Used by the row-scoped config path's add-mode: `setConfig`
   *  creates the row on first save, not before. */
  createChargerRow(): Promise<ChargerRow> {
    return this.chargingPoints.ensureCharger(this.pluginId);
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
   *  plugin's own id — a plugin cannot write another plugin's vehicles.
   *  Routed through the host so a new vehicle gets its charging point. */
  async upsertVehicleRow(
    input: Omit<UpsertVehicleInput, "adapterType">,
  ): Promise<void> {
    await this.db.upsertVehicle({ ...input, adapterType: this.pluginId });
    const row = await this.db.getVehicle(input.id);
    if (row) await this.chargingPoints.ensureVehicleChargingPoint(row);
  }

  // ── Vehicle lifecycle (notify VehicleManager) ────────────────────────

  /** Register one of this plugin's vehicles with VehicleManager. The adapter
   *  type is stamped with the plugin's own id — a plugin cannot register
   *  another plugin's vehicles. */
  addVehicle(row: Omit<VehicleRow, "adapterType">): Promise<void> {
    return this.vehicleManager.addVehicle({
      ...row,
      adapterType: this.pluginId,
    });
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
