-- WARNING: the INSERT at the bottom of this file is hand-written. drizzle-kit
-- emits DDL only and will not reproduce it. If this migration is ever deleted
-- and regenerated, re-append that block or upgrading users lose control of
-- their existing vehicles.
CREATE TABLE `chargers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`charger_adapter_type` text NOT NULL,
	`charger_config` text DEFAULT '{}' NOT NULL,
	`charger_secrets` text DEFAULT '{}' NOT NULL,
	`charger_secrets_encrypted` integer DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'auto' NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`vehicle_id` text,
	`kind` text DEFAULT 'smart' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `schedules` ADD `charger_id` text;--> statement-breakpoint
-- Split pre-charger vehicles into a vehicle + a charging point. Ids are
-- derived from the vehicle so they survive deactivation and re-activation,
-- which is what keeps schedules attached. Adapter types are pinned to those
-- that existed at this version: later plugins create their own rows.
INSERT INTO `chargers` (
  `id`, `name`, `charger_adapter_type`, `charger_config`,
  `charger_secrets`, `charger_secrets_encrypted`,
  `mode`, `priority`, `vehicle_id`, `kind`, `active`,
  `created_at`, `updated_at`
)
SELECT
  'cp-' || `v`.`id`, `v`.`name`, `v`.`adapter_type`, '{}',
  '{}', 0,
  `v`.`mode`, `v`.`priority`, `v`.`id`, 'vehicle_api', 1,
  datetime('now'), datetime('now')
FROM `vehicles` `v`
WHERE `v`.`adapter_type` IN ('tesla', 'simulated');