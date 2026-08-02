CREATE TABLE `chargers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`charger_adapter_type` text NOT NULL,
	`charger_config` text DEFAULT '{}' NOT NULL,
	`mode` text DEFAULT 'auto' NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`vehicle_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
