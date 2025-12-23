CREATE TABLE `plugin_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`plugin_id` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`payload` text,
	`origin` text
);
--> statement-breakpoint
CREATE INDEX `idx_plugin_logs_plugin_ts` ON `plugin_logs` (`plugin_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_plugin_logs_ts` ON `plugin_logs` (`timestamp`);
