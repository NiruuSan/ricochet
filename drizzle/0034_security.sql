ALTER TABLE `two_factor` ADD `lockouts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `admin_elevations` (
	`session` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`until` integer NOT NULL,
	`created` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `admin_elevation_user` ON `admin_elevations` (`user_id`);