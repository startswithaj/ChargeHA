import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---- Energy Readings ----

export const energyReadings = sqliteTable("energy_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  solarProductionW: real("solar_production_w").notNull(),
  gridPowerW: real("grid_power_w").notNull(),
  homeConsumptionW: real("home_consumption_w").notNull(),
  batteryPowerW: real("battery_power_w"),
  batterySoc: real("battery_soc"),
  ratePerKwh: real("rate_per_kwh"),
  // 1 when the energy adapter poll threw — EnergyPoller writes a zero-valued row
  // as a breadcrumb. Aggregation queries exclude these so failures do not skew totals.
  pollFailed: integer("poll_failed").notNull().default(0),
}, (table) => [
  index("idx_energy_readings_timestamp").on(table.timestamp),
]);

// ---- Config (key-value store) ----

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  isEncrypted: integer("is_encrypted").notNull().default(0),
});

// ---- Vehicle Charge Readings ----

export const vehicleChargeReadings = sqliteTable("vehicle_charge_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  vehicleId: text("vehicle_id").notNull(),
  chargePowerW: real("charge_power_w").notNull(),
  chargeAmps: integer("charge_amps").notNull(),
  batteryLevel: integer("battery_level"),
  solarContributionW: real("solar_contribution_w").notNull(),
  gridContributionW: real("grid_contribution_w").notNull(),
  isHome: integer("is_home").notNull().default(1),
  ratePerKwh: real("rate_per_kwh"),
}, (table) => [
  index("idx_vcr_vehicle_ts").on(table.vehicleId, table.timestamp),
  index("idx_vcr_timestamp").on(table.timestamp),
]);

// ---- Vehicle Poll Logs ----
// Legacy name: originally populated by a background VehiclePoller. The poller
// was replaced by on-demand fetches through the middleware layer (see
// VehicleManager.requestState / VehicleFetchLogger). The table keeps the
// "poll" name because renaming requires a migration.

export const vehiclePollLogs = sqliteTable("vehicle_poll_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  vehicleId: text("vehicle_id").notNull(),
  vehicleName: text("vehicle_name").notNull(),
  isOnline: integer("is_online").notNull(),
  isPluggedIn: integer("is_plugged_in").notNull(),
  isCharging: integer("is_charging").notNull(),
  batteryLevel: integer("battery_level").notNull(),
  chargeLimit: integer("charge_limit").notNull(),
  chargeAmps: integer("charge_amps").notNull(),
  chargeAmpsMax: integer("charge_amps_max").notNull(),
  chargePowerKw: real("charge_power_kw").notNull(),
  chargerVoltage: integer("charger_voltage").notNull(),
  energyAddedKwh: real("energy_added_kwh").notNull(),
  minutesToFull: integer("minutes_to_full").notNull(),
}, (table) => [
  index("idx_vpl_vehicle_ts").on(table.vehicleId, table.timestamp),
  index("idx_vpl_timestamp").on(table.timestamp),
]);

// ---- Vehicles ----

export const vehicles = sqliteTable("vehicles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  adapterType: text("adapter_type").notNull(),
  priority: integer("priority").notNull().default(1),
  config: text("config").notNull(),
  mode: text("mode").notNull().default("auto"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ---- Schedules ----

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id"),
  scheduleType: text("schedule_type").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  daysJson: text("days_json").notNull(),
  chargeAmps: integer("charge_amps"),
  chargeLimitPct: integer("charge_limit_pct"),
  enabled: integer("enabled").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ---- Controller Logs ----

export const controllerLogs = sqliteTable("controller_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  vehicleId: text("vehicle_id").notNull(),
  vehicleName: text("vehicle_name").notNull(),
  mode: text("mode").notNull(),
  inputsJson: text("inputs_json").notNull(),
  checksJson: text("checks_json").notNull(),
  action: text("action").notNull(),
  actionDetail: text("action_detail").notNull(),
  targetAmps: integer("target_amps"),
  traceId: text("trace_id"),
}, (table) => [
  index("idx_controller_logs_ts").on(table.timestamp),
  index("idx_controller_logs_trace").on(table.traceId),
]);

// ---- Plugin Logs ----

export const pluginLogs = sqliteTable("plugin_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  pluginId: text("plugin_id").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  payload: text("payload"),
  origin: text("origin"),
  traceId: text("trace_id"),
}, (table) => [
  index("idx_plugin_logs_plugin_ts").on(table.pluginId, table.timestamp),
  index("idx_plugin_logs_ts").on(table.timestamp),
  index("idx_plugin_logs_trace").on(table.traceId),
]);

// ---- Auth: Local Users ----

export const authLocal = sqliteTable("auth_local", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_auth_local_username").on(table.username),
]);

// ---- Auth: OIDC Configuration ----

export const authOidc = sqliteTable("auth_oidc", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  issuerUrl: text("issuer_url").notNull(),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  isEncrypted: integer("is_encrypted").notNull().default(0),
  baseUrl: text("base_url").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ---- Auth: Sessions ----

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  authType: text("auth_type").notNull(),
  identifier: text("identifier").notNull(),
  email: text("email"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  index("idx_sessions_expires_at").on(table.expiresAt),
]);

// ---- Tariff Periods ----

export const tariffPeriods = sqliteTable("tariff_periods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  days: text("days").notNull(),
  ratePerKwh: real("rate_per_kwh").notNull(),
  enabled: integer("enabled").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
