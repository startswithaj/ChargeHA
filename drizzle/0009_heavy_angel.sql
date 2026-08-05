ALTER TABLE `chargers` ADD `kind` text DEFAULT 'smart' NOT NULL;--> statement-breakpoint
ALTER TABLE `chargers` ADD `active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Existing rows carried their kind implicitly in vehicle_id's nullness.
UPDATE `chargers` SET `kind` = 'vehicle_api' WHERE `vehicle_id` IS NOT NULL;--> statement-breakpoint
-- Split pre-charger vehicles into a vehicle + a charging point. Ids are
-- derived from the vehicle so they survive deactivation and re-activation,
-- which is what keeps schedules attached. Adapter types are pinned to those
-- that existed at this version: later plugins create their own rows.
-- Skipped entirely when a smart charger already owns control.
INSERT INTO `chargers` (
  `id`, `name`, `charger_adapter_type`, `charger_config`,
  `mode`, `priority`, `vehicle_id`, `kind`, `active`,
  `created_at`, `updated_at`
)
SELECT
  'cp-' || `v`.`id`, `v`.`name`, `v`.`adapter_type`, '{}',
  `v`.`mode`, `v`.`priority`, `v`.`id`, 'vehicle_api', 1,
  datetime('now'), datetime('now')
FROM `vehicles` `v`
WHERE `v`.`adapter_type` IN ('tesla', 'simulated')
  AND NOT EXISTS (
    SELECT 1 FROM `chargers` `c` WHERE `c`.`vehicle_id` = `v`.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `chargers` `s` WHERE `s`.`kind` = 'smart'
  );
