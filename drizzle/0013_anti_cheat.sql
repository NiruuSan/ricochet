CREATE TABLE `cheat_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_key` text,
	`kind` text NOT NULL,
	`level` text NOT NULL,
	`detail` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cheat_signal_user` ON `cheat_signals` (`user_id`,`created`);--> statement-breakpoint
CREATE INDEX `cheat_signal_run` ON `cheat_signals` (`run_key`,`kind`);--> statement-breakpoint
CREATE INDEX `cheat_signal_recent` ON `cheat_signals` (`created`);--> statement-breakpoint
CREATE TABLE `player_suspensions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`reason` text NOT NULL,
	`evidence` text NOT NULL,
	`created` integer NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `shot_analysis` (
	`run_key` text NOT NULL,
	`revision` integer NOT NULL,
	`user_id` text NOT NULL,
	`aim_ms` integer,
	`gain` integer NOT NULL,
	`best_gain` integer NOT NULL,
	`best_share` real NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`run_key`, `revision`)
);
--> statement-breakpoint
CREATE INDEX `shot_analysis_user` ON `shot_analysis` (`user_id`,`created`);--> statement-breakpoint
ALTER TABLE `matches` ADD `disqualified` text;--> statement-breakpoint
ALTER TABLE `run_shots` ADD `ticks` integer;--> statement-breakpoint
ALTER TABLE `tournament_entries` ADD `disqualified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Suspended and banned players cannot withdraw or tip, whatever path writes the row.
CREATE TRIGGER suspension_withdrawal BEFORE INSERT ON cash_transfers
WHEN NEW.kind = 'withdrawal' AND EXISTS (
  SELECT 1 FROM player_suspensions WHERE user_id = NEW.user_id AND status IN ('suspended', 'banned')
)
BEGIN
  SELECT RAISE(ABORT, 'account suspended');
END;
--> statement-breakpoint
CREATE TRIGGER suspension_tip BEFORE INSERT ON cash_ledger
WHEN NEW.kind = 'tip_sent' AND EXISTS (
  SELECT 1 FROM player_suspensions WHERE user_id = substr(NEW.account_id, 8) AND status IN ('suspended', 'banned')
)
BEGIN
  SELECT RAISE(ABORT, 'account suspended');
END;
