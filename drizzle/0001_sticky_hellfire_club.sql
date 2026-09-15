CREATE TABLE `cash_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`user_id` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	CONSTRAINT "cash_balance_nonnegative" CHECK("cash_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_account_owner` ON `cash_accounts` (`network`,`user_id`);--> statement-breakpoint
CREATE TABLE `cash_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `cash_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cash_ledger_account` ON `cash_ledger` (`account_id`,`created`);--> statement-breakpoint
CREATE TABLE `custody_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`owner` text NOT NULL,
	`address` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custody_owner` ON `custody_wallets` (`network`,`owner`);--> statement-breakpoint
CREATE UNIQUE INDEX `custody_address` ON `custody_wallets` (`address`);--> statement-breakpoint
CREATE TABLE `cash_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`destination` text NOT NULL,
	`amount` integer NOT NULL,
	`fee` integer NOT NULL,
	`signature` text NOT NULL,
	`wire` text NOT NULL,
	`last_valid_block_height` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`slot` integer,
	`error` text,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_signature` ON `cash_transfers` (`signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_pending_source` ON `cash_transfers` (`source`) WHERE "cash_transfers"."status" IN ('pending','review');--> statement-breakpoint
CREATE INDEX `transfer_owner` ON `cash_transfers` (`user_id`,`created`);--> statement-breakpoint
ALTER TABLE `matches` ADD `asset` text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
CREATE TRIGGER cash_ledger_apply AFTER INSERT ON cash_ledger BEGIN UPDATE cash_accounts SET balance=balance+NEW.amount WHERE id=NEW.account_id; END;

--> statement-breakpoint
CREATE TRIGGER cash_ledger_guard BEFORE INSERT ON cash_ledger WHEN NOT EXISTS (SELECT 1 FROM cash_ledger WHERE id=NEW.id) AND COALESCE((SELECT balance FROM cash_accounts WHERE id=NEW.account_id)+NEW.amount,-1)<0 BEGIN SELECT RAISE(ABORT, 'cash balance insufficient'); END;
