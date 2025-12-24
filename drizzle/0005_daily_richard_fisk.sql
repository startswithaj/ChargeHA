ALTER TABLE `controller_logs` ADD `trace_id` text;--> statement-breakpoint
CREATE INDEX `idx_controller_logs_trace` ON `controller_logs` (`trace_id`);--> statement-breakpoint
ALTER TABLE `plugin_logs` ADD `trace_id` text;--> statement-breakpoint
CREATE INDEX `idx_plugin_logs_trace` ON `plugin_logs` (`trace_id`);