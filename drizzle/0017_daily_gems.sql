CREATE TABLE `daily_claims` (
	`user_id` text NOT NULL,
	`day` integer NOT NULL,
	`streak` integer NOT NULL,
	`amount` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`)
);
