CREATE TABLE `referral_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `referral_code_owner` ON `referral_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`user_id` text PRIMARY KEY NOT NULL,
	`referrer_id` text NOT NULL,
	`level` integer NOT NULL,
	`discount_until` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `referral_referrer` ON `referrals` (`referrer_id`);--> statement-breakpoint
ALTER TABLE `players` ADD `referral_code` text;--> statement-breakpoint
ALTER TABLE `players` ADD `referral_level` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `player_referral_code` ON `players` (`referral_code`);