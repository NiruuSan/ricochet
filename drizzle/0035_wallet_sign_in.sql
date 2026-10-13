CREATE TABLE `wallet_challenges` (
	`nonce` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`expires` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `wallet_challenge_expiry` ON `wallet_challenges` (`expires`);
