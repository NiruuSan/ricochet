CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `notification_owner` ON `notifications` (`user_id`,`created`);--> statement-breakpoint
ALTER TABLE `runs` ADD `clears` integer DEFAULT 0 NOT NULL;