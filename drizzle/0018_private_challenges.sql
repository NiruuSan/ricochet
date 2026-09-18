ALTER TABLE `matches` ADD `invite` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `invited` text;--> statement-breakpoint
CREATE UNIQUE INDEX `match_invite` ON `matches` (`invite`);