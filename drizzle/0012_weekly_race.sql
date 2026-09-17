CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_race_exclusions` (
	`week_start` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`admin_id` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`week_start`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `weekly_races` (
	`week_start` integer PRIMARY KEY NOT NULL,
	`winners` text NOT NULL,
	`paid_by` text NOT NULL,
	`paid_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `runs` ADD `finished` integer;--> statement-breakpoint
CREATE INDEX `runs_finished` ON `runs` (`finished`);--> statement-breakpoint
CREATE INDEX `tournament_entry_finished` ON `tournament_entries` (`finished`);--> statement-breakpoint
-- Finished runs from before this column: the time of their last shot, or their start.
UPDATE `runs` SET `finished` = COALESCE((SELECT MAX(s.created) FROM run_shots s WHERE s.run_key = 'm-' || runs.id), runs.created) WHERE `done` = 1;
