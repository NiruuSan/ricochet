CREATE TABLE `blocks` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`)
);
--> statement-breakpoint
CREATE INDEX `block_blocked` ON `blocks` (`blocked_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`created` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `report_open` ON `reports` (`status`,`created`);--> statement-breakpoint
CREATE INDEX `report_target` ON `reports` (`target_id`);--> statement-breakpoint
CREATE INDEX `report_reporter` ON `reports` (`reporter_id`);