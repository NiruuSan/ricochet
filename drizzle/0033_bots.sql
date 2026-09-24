ALTER TABLE `players` ADD `bot` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `player_bot` ON `players` (`bot`);