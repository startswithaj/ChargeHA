CREATE TABLE `auth_local` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_local_username` ON `auth_local` (`username`);--> statement-breakpoint
CREATE TABLE `auth_oidc` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issuer_url` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`is_encrypted` integer DEFAULT 0 NOT NULL,
	`base_url` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_type` text NOT NULL,
	`identifier` text NOT NULL,
	`email` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `config` (`key`, `value`, `is_encrypted`) VALUES ('auth_mode', 'none', 0);