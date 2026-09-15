CREATE TABLE `avatars` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `avatar_owner` ON `avatars` (`user_id`);--> statement-breakpoint
-- Demo credits become gems: 1 demo SOL (1,000,000,000 units) = 100 gems.
UPDATE `ledger` SET `amount` = `amount` / 10000000;--> statement-breakpoint
UPDATE `matches` SET `asset` = 'gems', `stake` = `stake` / 10000000, `fee` = `fee` / 10000000 WHERE `asset` = 'demo';--> statement-breakpoint
CREATE TABLE `__new_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`seed` integer NOT NULL,
	`stake` integer NOT NULL,
	`asset` text DEFAULT 'gems' NOT NULL,
	`p1` text NOT NULL,
	`p2` text,
	`settled` integer DEFAULT 0 NOT NULL,
	`winner` text,
	`fee` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`ruleset` integer DEFAULT 2 NOT NULL,
	`cancelled` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_matches`("id", "seed", "stake", "asset", "p1", "p2", "settled", "winner", "fee", "created", "ruleset", "cancelled") SELECT "id", "seed", "stake", "asset", "p1", "p2", "settled", "winner", "fee", "created", "ruleset", "cancelled" FROM `matches`;--> statement-breakpoint
DROP TABLE `matches`;--> statement-breakpoint
ALTER TABLE `__new_matches` RENAME TO `matches`;--> statement-breakpoint
CREATE INDEX `match_queue` ON `matches` (`stake`,`settled`,`p2`,`created`);--> statement-breakpoint
-- The balance trigger names `players`, which is rebuilt below; recreate it afterwards.
DROP TRIGGER `ledger_apply_balance`;--> statement-breakpoint
CREATE TABLE `__new_players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`balance` integer DEFAULT 2000 NOT NULL,
	`created` integer NOT NULL,
	`last_seen` integer DEFAULT 0 NOT NULL,
	`avatar` text,
	CONSTRAINT "balance_nonnegative" CHECK("balance" >= 0)
);
--> statement-breakpoint
-- Balances are rebuilt from the converted ledger (truncated amounts can only lower them).
INSERT INTO `__new_players`("id", "name", "balance", "created") SELECT "id", "name", MAX(0, 2000 + COALESCE((SELECT SUM(l."amount") FROM `ledger` l WHERE l."user_id" = `players`."id"), 0)), "created" FROM `players`;--> statement-breakpoint
-- Names become unique regardless of case; later duplicates get a random suffix.
UPDATE `__new_players` SET `name` = substr(`name`, 1, 15) || '_' || lower(hex(randomblob(2))) WHERE rowid NOT IN (SELECT MIN(rowid) FROM `__new_players` GROUP BY lower(`name`));--> statement-breakpoint
DROP TABLE `players`;--> statement-breakpoint
ALTER TABLE `__new_players` RENAME TO `players`;--> statement-breakpoint
CREATE UNIQUE INDEX `player_name_unique` ON `players` (lower("name"));--> statement-breakpoint
CREATE TRIGGER ledger_apply_balance AFTER INSERT ON ledger BEGIN UPDATE players SET balance=balance+NEW.amount WHERE id=NEW.user_id; END;
