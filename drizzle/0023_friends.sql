CREATE TABLE `friend_links` (
	`low_id` text NOT NULL,
	`high_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`status` text NOT NULL,
	`created` integer NOT NULL,
	`answered` integer,
	PRIMARY KEY(`low_id`, `high_id`)
);
--> statement-breakpoint
CREATE INDEX `friend_low` ON `friend_links` (`low_id`,`status`);--> statement-breakpoint
CREATE INDEX `friend_high` ON `friend_links` (`high_id`,`status`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`low_id` text NOT NULL,
	`high_id` text NOT NULL,
	`from_id` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `message_thread` ON `messages` (`low_id`,`high_id`,`created`);--> statement-breakpoint
CREATE INDEX `message_unread` ON `messages` (`from_id`,`read_at`);