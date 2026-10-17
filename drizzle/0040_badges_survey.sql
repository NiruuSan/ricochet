CREATE TABLE `player_badges` (
	`user_id` text NOT NULL,
	`badge` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted` integer NOT NULL,
	PRIMARY KEY(`user_id`, `badge`)
);--> statement-breakpoint
CREATE TABLE `survey_responses` (
	`user_id` text NOT NULL,
	`survey` text NOT NULL,
	`score` integer NOT NULL,
	`answer` text,
	`games` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`user_id`, `survey`)
);--> statement-breakpoint
CREATE INDEX `survey_by_time` ON `survey_responses` (`survey`,`created`);
