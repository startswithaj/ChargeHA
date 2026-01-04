import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import type { DatabaseDriver } from "@chargeha/shared/database-driver";
import { CompatDatabase } from "./SqliteCompat.ts";
import type { EnergyData, VehicleMode } from "@chargeha/shared";
import type { CoreConfigKey } from "@chargeha/shared/configSections";
import { Logger } from "../lib/Logger.ts";
import { readSecret, storeSecret } from "../lib/Encryption.ts";
import type { TypedEventEmitter } from "../services/TypedEventEmitter.ts";
import { runMigrations } from "./MigrationRunner.ts";
import { ConfigRepository } from "./repositories/ConfigRepository.ts";
import { EnergyRepository } from "./repositories/EnergyRepository.ts";
import { LogRepository } from "./repositories/LogRepository.ts";
import { ScheduleRepository } from "./repositories/ScheduleRepository.ts";
import { SessionRepository } from "./repositories/SessionRepository.ts";
import { TariffRepository } from "./repositories/TariffRepository.ts";
import { StatsRepository } from "./repositories/StatsRepository.ts";
import { VehicleRepository } from "./repositories/VehicleRepository.ts";

import type {
  ControllerLogInput,
  ControllerLogRow,
  CreateLocalUserInput,
  CreateScheduleInput,
  CreateSessionInput,
  CreateTariffPeriodInput,
  EnergySummary,
  LocalUserRow,
  OidcConfigRow,
  PluginLogInput,
  RecentStateChange,
  ScheduleRow,
  SessionRow,
  TariffPeriodRow,
  UpsertOidcConfigInput,
  UpsertVehicleInput,
  VehicleChargeReadingInput,
  VehiclePollLogInput,
  VehicleRow,
} from "./types.ts";

export class AppDatabase {
  private sqlite: DatabaseDriver;

  /** Low-level driver access for seed scripts and migrations.
   *  Not for runtime use — services should go through the repositories. */
  getDriver(): DatabaseDriver {
    return this.sqlite;
  }

  private logger: Logger;
  private readonly encryptionKey: string | null;
  private readonly eventEmitter: TypedEventEmitter | null;
  db: BetterSQLite3Database;
  config: ConfigRepository;
  energy: EnergyRepository;
  logs: LogRepository;
  schedules: ScheduleRepository;
  sessions: SessionRepository;
  stats: StatsRepository;
  tariffs: TariffRepository;
  vehicles: VehicleRepository;

  constructor(
    pathOrDb: string | DatabaseDriver,
    encryptionKey: string | null = null,
    eventEmitter: TypedEventEmitter | null = null,
    logger?: Logger,
  ) {
    this.sqlite = typeof pathOrDb === "string"
      ? new CompatDatabase(pathOrDb)
      : pathOrDb;
    this.encryptionKey = encryptionKey;
    this.eventEmitter = eventEmitter;
    // Tests construct AppDatabase without a logger — fall back to an
    // error-only logger so test output stays clean.
    this.logger = logger ?? new Logger("DB", "error");
    this.sqlite.exec("PRAGMA journal_mode = WAL");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    this.db = drizzle(this.sqlite as unknown as Parameters<typeof drizzle>[0]);
    this.config = new ConfigRepository(this.db);
    this.energy = new EnergyRepository(this.db);
    this.logs = new LogRepository(this.db);
    this.schedules = new ScheduleRepository(this.db);
    this.sessions = new SessionRepository(this.db);
    this.stats = new StatsRepository(this.db);
    this.tariffs = new TariffRepository(this.db);
    this.vehicles = new VehicleRepository(this.db);
  }

  async init(): Promise<void> {
    // Run Drizzle migrations directly via @db/sqlite (not through drizzle proxy)
    // so we get proper error handling per migration.
    runMigrations(this.sqlite, this.logger);
    // Seed default tariff config keys if not already set
    const defaultRate = await this.getConfig("default_rate_per_kwh");
    if (defaultRate === null) await this.setConfig("default_rate_per_kwh", "0");
    const currencySymbol = await this.getConfig("currency_symbol");
    if (currencySymbol === null) await this.setConfig("currency_symbol", "$");
    const currencyCode = await this.getConfig("currency_code");
    if (currencyCode === null) await this.setConfig("currency_code", "AUD");
  }

  // ---- Energy ----
  async insertEnergyReading(
    realtime: EnergyData,
    ratePerKwh?: number | null,
  ): Promise<void> {
    return await this.energy.insertEnergyReading(realtime, ratePerKwh);
  }
  async getRecentReadings(
    limit = 60,
  ): Promise<Array<EnergyData & { timestamp: string }>> {
    return await this.energy.getRecentReadings(limit);
  }
  async getTodayEnergySummary(timezone: string): Promise<EnergySummary> {
    return await this.energy.getTodayEnergySummary(timezone);
  }
  async pruneEnergyReadings(retentionDays: number): Promise<void> {
    return await this.energy.pruneEnergyReadings(retentionDays);
  }
  // ---- Config ----
  async getConfig(key: CoreConfigKey): Promise<string | null> {
    return await this.config.getConfig(key);
  }
  async setConfig(key: CoreConfigKey, value: string): Promise<void> {
    await this.config.setConfig(key, value);
    this.eventEmitter?.emit("config_changed", { key });
  }
  // Raw, unprefixed access used by PluginDependencies. Plugins pass already-
  // namespaced keys like "tesla.client_id"; their own key unions are
  // enforced at the PluginDependencies boundary.
  async getPluginConfig(key: string): Promise<string | null> {
    return await this.config.getConfig(key);
  }
  async setPluginConfig(key: string, value: string): Promise<void> {
    await this.config.setConfig(key, value);
    this.eventEmitter?.emit("config_changed", { key });
  }
  async setSecret(
    key: string,
    value: string,
    isEncrypted: boolean,
  ): Promise<void> {
    return await this.config.setSecret(key, value, isEncrypted);
  }
  async getSecret(
    key: string,
  ): Promise<{ value: string; isEncrypted: boolean } | null> {
    return await this.config.getSecret(key);
  }
  async hasEncryptedRows(): Promise<boolean> {
    return await this.config.hasEncryptedRows();
  }
  /**
   * Store a secret, encrypting it with the configured encryption key if one
   * is set. Wraps the low-level `setSecret` so callers don't need to know
   * about encryption.
   */
  async storeSecret(key: string, plaintext: string): Promise<void> {
    await storeSecret(this, key, plaintext, this.encryptionKey);
    this.eventEmitter?.emit("config_changed", { key });
  }
  /**
   * Read a secret, decrypting it with the configured encryption key if the
   * stored row is marked encrypted. Wraps the low-level `getSecret`.
   */
  async readSecret(key: string): Promise<string | null> {
    return await readSecret(this, key, this.encryptionKey);
  }
  // ---- Vehicles ----
  async getVehicle(id: string): Promise<VehicleRow | null> {
    return await this.vehicles.getVehicle(id);
  }
  async getVehicles(): Promise<VehicleRow[]> {
    return await this.vehicles.getVehicles();
  }
  async deleteVehicle(id: string): Promise<void> {
    return await this.vehicles.deleteVehicle(id);
  }
  async updateVehicleMode(id: string, mode: VehicleMode): Promise<void> {
    return await this.vehicles.updateVehicleMode(id, mode);
  }
  async updateVehiclePriority(id: string, priority: number): Promise<void> {
    return await this.vehicles.updateVehiclePriority(id, priority);
  }
  async getNextVehiclePriority(): Promise<number> {
    return await this.vehicles.getNextVehiclePriority();
  }
  async resequenceVehiclePriorities(): Promise<void> {
    return await this.vehicles.resequenceVehiclePriorities();
  }
  async upsertVehicle(input: UpsertVehicleInput): Promise<void> {
    return await this.vehicles.upsertVehicle(input);
  }
  async insertVehicleChargeReading(
    reading: VehicleChargeReadingInput,
  ): Promise<void> {
    return await this.vehicles.insertVehicleChargeReading(reading);
  }
  async pruneVehicleChargeReadings(retentionDays: number): Promise<void> {
    return await this.vehicles.pruneVehicleChargeReadings(retentionDays);
  }
  // ---- Schedules ----
  async getSchedules(): Promise<ScheduleRow[]> {
    return await this.schedules.getSchedules();
  }
  async getSchedule(id: string): Promise<ScheduleRow | null> {
    return await this.schedules.getSchedule(id);
  }
  async createSchedule(input: CreateScheduleInput): Promise<void> {
    return await this.schedules.createSchedule(input);
  }
  async updateSchedule(
    id: string,
    input: Partial<Omit<CreateScheduleInput, "id">>,
  ): Promise<void> {
    return await this.schedules.updateSchedule(id, input);
  }
  async deleteSchedule(id: string): Promise<void> {
    return await this.schedules.deleteSchedule(id);
  }
  async deleteSchedulesByVehicle(vehicleId: string): Promise<void> {
    return await this.schedules.deleteSchedulesByVehicle(vehicleId);
  }
  // ---- Tariffs ----
  async getTariffPeriods(): Promise<TariffPeriodRow[]> {
    return await this.tariffs.getTariffPeriods();
  }
  async getTariffPeriod(id: number): Promise<TariffPeriodRow | null> {
    return await this.tariffs.getTariffPeriod(id);
  }
  async createTariffPeriod(input: CreateTariffPeriodInput): Promise<number> {
    return await this.tariffs.createTariffPeriod(input);
  }
  async updateTariffPeriod(
    id: number,
    input: Partial<CreateTariffPeriodInput>,
  ): Promise<void> {
    return await this.tariffs.updateTariffPeriod(id, input);
  }
  async deleteTariffPeriod(id: number): Promise<void> {
    return await this.tariffs.deleteTariffPeriod(id);
  }
  async deleteAllTariffPeriods(): Promise<void> {
    return await this.tariffs.deleteAllTariffPeriods();
  }
  // ---- Logs ----
  async insertControllerLogEntries(
    entries: ControllerLogInput[],
  ): Promise<void> {
    return await this.logs.insertControllerLogEntries(entries);
  }
  async getRecentStateChanges(
    sinceMinutes: number,
    after?: string,
  ): Promise<RecentStateChange[]> {
    return await this.logs.getRecentStateChanges(sinceMinutes, after);
  }
  async getLastControllerLogPerVehicle(): Promise<ControllerLogRow[]> {
    return await this.logs.getLastControllerLogPerVehicle();
  }
  async pruneControllerLogs(retentionDays: number): Promise<void> {
    return await this.logs.pruneControllerLogs(retentionDays);
  }
  async insertVehiclePollLog(input: VehiclePollLogInput): Promise<void> {
    return await this.logs.insertVehiclePollLog(input);
  }
  async pruneVehiclePollLogs(retentionDays: number): Promise<void> {
    return await this.logs.pruneVehiclePollLogs(retentionDays);
  }
  async insertPluginLog(input: PluginLogInput): Promise<void> {
    return await this.logs.insertPluginLog(input);
  }
  async prunePluginLogs(retentionDays: number): Promise<void> {
    return await this.logs.prunePluginLogs(retentionDays);
  }
  // ---- Auth ----
  async createLocalUser(input: CreateLocalUserInput): Promise<LocalUserRow> {
    return await this.sessions.createLocalUser(input);
  }
  async getLocalUser(username: string): Promise<LocalUserRow | null> {
    return await this.sessions.getLocalUser(username);
  }
  async getFirstLocalUser(): Promise<LocalUserRow | null> {
    return await this.sessions.getFirstLocalUser();
  }
  async updateLocalUserPassword(
    username: string,
    passwordHash: string,
  ): Promise<void> {
    return await this.sessions.updateLocalUserPassword(username, passwordHash);
  }
  async deleteAllLocalUsers(): Promise<void> {
    return await this.sessions.deleteAllLocalUsers();
  }
  async upsertOidcConfig(
    input: UpsertOidcConfigInput,
  ): Promise<OidcConfigRow> {
    return await this.sessions.upsertOidcConfig(input);
  }
  async getOidcConfig(): Promise<OidcConfigRow | null> {
    return await this.sessions.getOidcConfig();
  }
  async deleteOidcConfig(): Promise<void> {
    return await this.sessions.deleteOidcConfig();
  }
  async deleteAllOidcConfigs(): Promise<void> {
    return await this.sessions.deleteAllOidcConfigs();
  }
  async createSession(input: CreateSessionInput): Promise<SessionRow> {
    return await this.sessions.createSession(input);
  }
  async getSession(id: string): Promise<SessionRow | null> {
    return await this.sessions.getSession(id);
  }
  async deleteSession(id: string): Promise<void> {
    return await this.sessions.deleteSession(id);
  }
  async deleteAllSessions(): Promise<void> {
    return await this.sessions.deleteAllSessions();
  }
  async deleteSessionsExcept(exceptId: string): Promise<void> {
    return await this.sessions.deleteSessionsExcept(exceptId);
  }
  async deleteExpiredSessions(): Promise<void> {
    return await this.sessions.deleteExpiredSessions();
  }

  close(): void {
    this.sqlite.close();
  }
}
