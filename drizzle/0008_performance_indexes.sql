CREATE INDEX `cash_ledger_reference` ON `cash_ledger` (`reference`);--> statement-breakpoint
CREATE INDEX `ledger_match` ON `ledger` (`match_id`);--> statement-breakpoint
CREATE INDEX `match_p1` ON `matches` (`p1`,`created`);--> statement-breakpoint
CREATE INDEX `match_p2` ON `matches` (`p2`,`created`);--> statement-breakpoint
CREATE INDEX `player_presence` ON `players` (`last_seen`);--> statement-breakpoint
CREATE INDEX `runs_recent` ON `runs` (`created`);