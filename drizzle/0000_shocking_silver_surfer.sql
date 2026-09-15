CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`match_id` text,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_user` ON `ledger` (`user_id`,`created`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`seed` integer NOT NULL,
	`stake` integer NOT NULL,
	`p1` text NOT NULL,
	`p2` text,
	`settled` integer DEFAULT 0 NOT NULL,
	`winner` text,
	`fee` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `match_queue` ON `matches` (`stake`,`settled`,`p2`,`created`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`balance` integer DEFAULT 20000000000 NOT NULL,
	`created` integer NOT NULL,
	CONSTRAINT "balance_nonnegative" CHECK("players"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`forfeit` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_run_per_player_match` ON `runs` (`match_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_run_per_player` ON `runs` (`user_id`) WHERE "runs"."done"=0;--> statement-breakpoint
CREATE INDEX `runs_history` ON `runs` (`user_id`,`created`);--> statement-breakpoint
CREATE TRIGGER ledger_apply_balance AFTER INSERT ON ledger BEGIN UPDATE players SET balance=balance+NEW.amount WHERE id=NEW.user_id; END;
