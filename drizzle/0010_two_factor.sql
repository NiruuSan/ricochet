CREATE TABLE `two_factor` (
	`user_id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`last_step` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`enabled_at` integer
);
--> statement-breakpoint
CREATE TABLE `two_factor_recovery` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `two_factor_recovery_owner` ON `two_factor_recovery` (`user_id`);