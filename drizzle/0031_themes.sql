CREATE TABLE `theme_purchases` (
	`user_id` text NOT NULL,
	`theme` text NOT NULL,
	`asset` text NOT NULL,
	`price` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`user_id`, `theme`)
);
--> statement-breakpoint
ALTER TABLE `players` ADD `theme` text;