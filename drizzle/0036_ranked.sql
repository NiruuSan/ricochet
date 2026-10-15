CREATE TABLE `ranked_ratings` (
	`user_id` text NOT NULL,
	`season` integer NOT NULL,
	`rating` integer NOT NULL,
	`games` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`placements` integer NOT NULL,
	`peak` integer NOT NULL,
	`shield` integer DEFAULT 0 NOT NULL,
	`last_played` integer,
	`decayed` integer,
	`created` integer NOT NULL,
	PRIMARY KEY(`user_id`, `season`)
);--> statement-breakpoint
CREATE INDEX `ranked_by_rating` ON `ranked_ratings` (`season`,`rating`);--> statement-breakpoint
CREATE TABLE `rating_changes` (
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`season` integer NOT NULL,
	`opponent_id` text NOT NULL,
	`before` integer NOT NULL,
	`after` integer NOT NULL,
	`delta` integer NOT NULL,
	`opponent_rating` integer NOT NULL,
	`score` integer NOT NULL,
	`opponent_score` integer NOT NULL,
	`unrated` text,
	`created` integer NOT NULL,
	PRIMARY KEY(`match_id`, `user_id`)
);--> statement-breakpoint
CREATE INDEX `rating_change_pair` ON `rating_changes` (`user_id`,`opponent_id`,`created`);--> statement-breakpoint
ALTER TABLE `matches` ADD `ranked` integer DEFAULT 0 NOT NULL;
