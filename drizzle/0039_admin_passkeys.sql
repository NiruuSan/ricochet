CREATE TABLE `admin_passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`rp_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`name` text NOT NULL,
	`created` integer NOT NULL,
	`last_used` integer
);--> statement-breakpoint
CREATE INDEX `admin_passkey_user` ON `admin_passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `admin_passkey_challenges` (
	`session` text NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`challenge` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`session`, `kind`)
);
