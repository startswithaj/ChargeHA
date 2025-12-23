CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`is_encrypted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `controller_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`vehicle_id` text NOT NULL,
	`vehicle_name` text NOT NULL,
	`mode` text NOT NULL,
	`inputs_json` text NOT NULL,
	`checks_json` text NOT NULL,
	`action` text NOT NULL,
	`action_detail` text NOT NULL,
	`target_amps` integer
);
--> statement-breakpoint
CREATE INDEX `idx_controller_logs_ts` ON `controller_logs` (`timestamp`);--> statement-breakpoint
CREATE TABLE `energy_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`solar_production_w` real NOT NULL,
	`grid_power_w` real NOT NULL,
	`home_consumption_w` real NOT NULL,
	`battery_power_w` real,
	`battery_soc` real,
	`rate_per_kwh` real
);
--> statement-breakpoint
CREATE INDEX `idx_energy_readings_timestamp` ON `energy_readings` (`timestamp`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text,
	`schedule_type` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`days_json` text NOT NULL,
	`charge_amps` integer,
	`charge_limit_pct` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tariff_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`days` text NOT NULL,
	`rate_per_kwh` real NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vehicle_charge_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`vehicle_id` text NOT NULL,
	`charge_power_w` real NOT NULL,
	`charge_amps` integer NOT NULL,
	`battery_level` integer,
	`solar_contribution_w` real NOT NULL,
	`grid_contribution_w` real NOT NULL,
	`is_home` integer DEFAULT 1 NOT NULL,
	`rate_per_kwh` real
);
--> statement-breakpoint
CREATE INDEX `idx_vcr_vehicle_ts` ON `vehicle_charge_readings` (`vehicle_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_vcr_timestamp` ON `vehicle_charge_readings` (`timestamp`);--> statement-breakpoint
CREATE TABLE `vehicle_poll_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`vehicle_id` text NOT NULL,
	`vehicle_name` text NOT NULL,
	`is_online` integer NOT NULL,
	`is_plugged_in` integer NOT NULL,
	`is_charging` integer NOT NULL,
	`battery_level` integer NOT NULL,
	`charge_limit` integer NOT NULL,
	`charge_amps` integer NOT NULL,
	`charge_amps_max` integer NOT NULL,
	`charge_power_kw` real NOT NULL,
	`charger_voltage` integer NOT NULL,
	`energy_added_kwh` real NOT NULL,
	`minutes_to_full` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vpl_vehicle_ts` ON `vehicle_poll_logs` (`vehicle_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_vpl_timestamp` ON `vehicle_poll_logs` (`timestamp`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`adapter_type` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`config` text NOT NULL,
	`mode` text DEFAULT 'auto' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
