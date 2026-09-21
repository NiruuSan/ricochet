CREATE TABLE `quest_claims` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`period` integer NOT NULL,
	`quest` text NOT NULL,
	`amount` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`user_id`, `scope`, `period`, `quest`)
);
