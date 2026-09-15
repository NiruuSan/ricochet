CREATE TABLE `tournament_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`clears` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`forfeit` integer DEFAULT 0 NOT NULL,
	`registered` integer NOT NULL,
	`started` integer,
	`finished` integer,
	`rank` integer,
	`payout` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_entry_per_player` ON `tournament_entries` (`tournament_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `tournament_entry_owner` ON `tournament_entries` (`user_id`,`registered`);--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`asset` text NOT NULL,
	`entry_fee` integer DEFAULT 0 NOT NULL,
	`prize` integer DEFAULT 0 NOT NULL,
	`payout` text NOT NULL,
	`places` integer NOT NULL,
	`seed` integer NOT NULL,
	`ruleset` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tournament_schedule` ON `tournaments` (`status`,`ends_at`);