import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";

// Live charging load, already split by whether a physical meter would have
// counted it.
export type ChargingLoad = { unmeteredW: number; meteredW: number };
import { equipmentConfigDef } from "@chargeha/shared/configSections";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { Logger } from "../lib/Logger.ts";
import { NullEnergyAdapter } from "./NullEnergyAdapter.ts";

const ADAPTER_TYPE_KEY = equipmentConfigDef.energyAdapterType.key;

// ── EnergyAdapterManager ────────────────────────────────────────────────

// Owns the energy adapter lifecycle: resolves config from DB, constructs
// the correct adapter via plugin registry, and handles hot-swap on config
// change. Initialization kicks off in the constructor and is protected by
// `initializationPromise` so a concurrent `reconfigure()` can't clobber
// the in-flight initial adapter assignment.
//
// EM does not know about the poller. The poller subscribes to
// `config_changed` itself and calls `reconfigure()` + its own `restart()`
// when a key relevant to the active adapter is written.
//
// Not typed as EnergySourceAdapter: getRealtimeData takes the charging load
// as a parameter, which diverges from the adapter signature.
export class EnergyAdapterManager {
  private readonly db: AppDatabase;
  private readonly energyPlugins: EnergyPluginRegistry;
  private readonly logger: Logger;
  private adapter: EnergySourceAdapter | null = null;
  private activeType: string | null = null;
  private readonly initializationPromise: Promise<void>;

  constructor(
    db: AppDatabase,
    energyPlugins: EnergyPluginRegistry,
    logger: Logger,
  ) {
    this.db = db;
    this.energyPlugins = energyPlugins;
    this.logger = logger;
    this.initializationPromise = this.initialize();
  }

  // True if writing this config key should trigger a reconfigure.
  isRelevantConfigKey(key: string): boolean {
    if (key === ADAPTER_TYPE_KEY) return true;
    return this.activeType !== null && key.startsWith(`${this.activeType}.`);
  }

  // ── EnergySourceAdapter interface ──────────────────────────────────────

  pollIntervalSeconds(): number {
    return this.adapter?.pollIntervalSeconds() ?? 5;
  }

  // Resolves once the initial adapter has been constructed and (attempted
  // to) connect. Callers that depend on `pollIntervalSeconds()` or the active adapter should await this before reading.
  ready(): Promise<void> {
    return this.initializationPromise;
  }

  connect(): Promise<void> {
    if (!this.adapter) return Promise.resolve();
    return this.adapter.connect();
  }

  disconnect(): Promise<void> {
    if (!this.adapter) return Promise.resolve();
    return this.adapter.disconnect();
  }

  async getRealtimeData(load: ChargingLoad): Promise<EnergyData> {
    await this.initializationPromise;
    if (!this.adapter) {
      throw new Error("EnergyAdapterManager not initialized");
    }
    const data = await this.adapter.getRealtimeData();

    const addW = this.unseenLoadW(load);
    if (addW > 0) {
      return {
        ...data,
        homeConsumptionW: data.homeConsumptionW + addW,
        gridPowerW: data.gridPowerW + addW,
      };
    }

    return data;
  }

  // Watts the active adapter could not have measured, so they are missing
  // from its reading. See docs/simulated-load.md.
  private unseenLoadW({ unmeteredW, meteredW }: ChargingLoad): number {
    // Unmetered load moves no electricity, so no adapter can see it and it
    // always applies. Metered load is already inside a measuring adapter's
    // reading — adding it there would count the charger twice.
    const plugin = this.activeType === null
      ? undefined
      : this.energyPlugins.get(this.activeType);
    const measures = plugin?.measuresLoad ?? true;
    return unmeteredW + (measures ? 0 : meteredW);
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    await this.initializationPromise;
    if (!this.adapter) {
      throw new Error("EnergyAdapterManager not initialized");
    }
    return this.adapter.getDeviceInfo();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  private async initialize(): Promise<void> {
    this.adapter = await this.buildAdapter();
    try {
      await this.adapter.connect();
    } catch (err) {
      this.logger.warn(
        `Energy adapter connection failed — will retry on first poll: ${err}`,
      );
    }
  }

  // Hot-swap: await in-flight initialization, build a new adapter, connect,
  // and swap. The poller calls this itself in response to `config_changed` and restarts its own timer afterwards.
  async reconfigure(): Promise<void> {
    await this.initializationPromise;
    const newAdapter = await this.buildAdapter();
    try {
      await newAdapter.connect();
    } catch (err) {
      this.logger.warn(
        `New energy adapter connection failed — will retry on first poll: ${err}`,
      );
    }
    this.adapter = newAdapter;
    this.logger.info(
      `Energy adapter reconfigured to ${newAdapter.constructor.name}`,
    );
  }

  // ── Router service methods ──────────────────────────────────────────

  getPluginSummaries(): Array<{
    id: string;
    displayName: string;
    vendor: string;
    settingsComponentKey: string | null;
    configured: boolean;
  }> {
    return this.energyPlugins.getAll().map((plugin) => ({
      id: plugin.id,
      displayName: plugin.displayName,
      vendor: plugin.vendor,
      settingsComponentKey: plugin.settingsComponentKey,
      configured: this.activeType === plugin.id,
    }));
  }

  async getRecentReadings(
    limit?: number,
  ): Promise<{ readings: Array<EnergyData & { timestamp: string }> }> {
    const readings = await this.db.getRecentReadings(limit ?? 60);
    return { readings };
  }

  // Read the active energy adapter type from the DB and ask the matching
  // plugin to build the adapter. Falls back to NullEnergyAdapter on any failure so the app keeps running.
  private async buildAdapter(): Promise<EnergySourceAdapter> {
    const adapterType = await this.db.getConfig(ADAPTER_TYPE_KEY);

    if (!adapterType || adapterType === "none") {
      this.activeType = null;
      return new NullEnergyAdapter(new Logger("NullEnergy"));
    }

    const plugin = this.energyPlugins.get(adapterType);
    if (!plugin) {
      this.logger.warn(
        `Energy plugin "${adapterType}" not registered — falling back to none`,
      );
      this.activeType = null;
      return new NullEnergyAdapter(new Logger("NullEnergy"));
    }

    try {
      const adapter = await plugin.createAdapter();
      this.activeType = adapterType;
      return adapter;
    } catch (err) {
      this.logger.warn(
        `Energy plugin "${adapterType}" failed to create adapter: ${err} — falling back to none`,
      );
      // Keep the selected type active so later writes to its keys retry the build.
      this.activeType = adapterType;
      return new NullEnergyAdapter(new Logger("NullEnergy"));
    }
  }
}
