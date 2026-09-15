CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window`)
);
--> statement-breakpoint
ALTER TABLE `matches` ADD `ruleset` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `cancelled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `transfer_status` ON `cash_transfers` (`status`,`created`);