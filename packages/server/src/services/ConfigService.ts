import type { AppDatabase } from "../db/AppDatabase.ts";
import {
  type BatteryConfig,
  batteryConfigDef,
  type ChargingConfig,
  chargingConfigDef,
  type CoreConfigKey,
  deserializeSection,
  type EquipmentConfig,
  equipmentConfigDef,
  type HomeConfig,
  homeConfigDef,
  type InternalConfig,
  internalConfigDef,
  type NotificationConfig,
  notificationConfigDef,
  sectionDbKeys,
  serializeSection,
  type SolarConfig,
  solarConfigDef,
  type SystemConfig,
  systemConfigDef,
} from "@chargeha/shared/configSections";
import type { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import type { Logger } from "../lib/Logger.ts";

export class ConfigService {
  constructor(
    private db: AppDatabase,
    private energyManager: EnergyAdapterManager,
    private encryptionKey: string | null,
    private logger: Logger,
  ) {}

  // ── Generic section helpers ────────────────────────────────────────────

  /** Read raw string values for a section's DB keys. */
  private async readSectionRaw<K extends CoreConfigKey>(
    dbKeys: K[],
  ): Promise<Record<K, string | null>> {
    const values = await Promise.all(
      dbKeys.map((key) => this.db.getConfig(key)),
    );
    return Object.fromEntries(
      dbKeys.map((key, i) => [key, values[i]]),
    ) as Record<K, string | null>;
  }

  /** Write serialized key-value pairs to the DB. The EnergyPoller listens
   *  for config_changed events from the DB and drives any adapter rebuild
   *  itself, so we don't need to poke it from here. */
  private async writeSectionRaw<K extends CoreConfigKey>(
    kvPairs: Record<K, string>,
  ): Promise<void> {
    await Promise.all(
      (Object.entries(kvPairs) as [K, string][]).map(
        ([key, value]) => this.db.setConfig(key, value),
      ),
    );
  }

  // ── Typed section getters ──────────────────────────────────────────────

  async getCharging(): Promise<ChargingConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(chargingConfigDef));
    return deserializeSection(chargingConfigDef, raw);
  }

  async getSolar(): Promise<SolarConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(solarConfigDef));
    return deserializeSection(solarConfigDef, raw);
  }

  async getBattery(): Promise<BatteryConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(batteryConfigDef));
    return deserializeSection(batteryConfigDef, raw);
  }

  async getHome(): Promise<HomeConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(homeConfigDef));
    return deserializeSection(homeConfigDef, raw);
  }

  async getEquipment(): Promise<EquipmentConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(equipmentConfigDef));
    return deserializeSection(equipmentConfigDef, raw);
  }

  async getSystem(): Promise<SystemConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(systemConfigDef));
    return deserializeSection(systemConfigDef, raw);
  }

  async getNotification(): Promise<NotificationConfig> {
    const raw = await this.readSectionRaw(
      sectionDbKeys(notificationConfigDef),
    );
    return deserializeSection(notificationConfigDef, raw);
  }

  async getInternal(): Promise<InternalConfig> {
    const raw = await this.readSectionRaw(sectionDbKeys(internalConfigDef));
    return deserializeSection(internalConfigDef, raw);
  }

  // ── Typed section setters ──────────────────────────────────────────────

  setCharging(input: Partial<ChargingConfig>): Promise<void> {
    const kvPairs = serializeSection(chargingConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setSolar(input: Partial<SolarConfig>): Promise<void> {
    const kvPairs = serializeSection(solarConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setBattery(input: Partial<BatteryConfig>): Promise<void> {
    const kvPairs = serializeSection(batteryConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setHome(input: Partial<HomeConfig>): Promise<void> {
    const kvPairs = serializeSection(homeConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setEquipment(input: Partial<EquipmentConfig>): Promise<void> {
    const kvPairs = serializeSection(equipmentConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setSystem(input: Partial<SystemConfig>): Promise<void> {
    const kvPairs = serializeSection(systemConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setNotification(
    input: Partial<NotificationConfig>,
  ): Promise<void> {
    const kvPairs = serializeSection(notificationConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  setInternal(input: Partial<InternalConfig>): Promise<void> {
    const kvPairs = serializeSection(internalConfigDef, input);
    return this.writeSectionRaw(kvPairs);
  }

  /** Get the current system alert string. */
  async getSystemAlert(): Promise<string> {
    const internal = await this.getInternal();
    return internal.systemAlert;
  }

  /** Clear the system alert. */
  async dismissSystemAlert(): Promise<{ success: boolean }> {
    await this.db.setConfig("system_alert", "");
    return { success: true };
  }

  /** Set a single config value. The EnergyPoller subscribes to
   *  config_changed and drives any adapter rebuild itself. */
  async setConfigValue(
    key: CoreConfigKey,
    value: string,
  ): Promise<{ key: CoreConfigKey; value: string }> {
    await this.db.setConfig(key, value);
    return { key, value };
  }
}
