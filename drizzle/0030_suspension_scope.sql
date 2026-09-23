ALTER TABLE `player_suspensions` ADD `restricted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player_suspensions` ADD `appeal` text;--> statement-breakpoint
ALTER TABLE `player_suspensions` ADD `appealed_at` integer;