PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_quest_claims` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`period` integer NOT NULL,
	`quest` text NOT NULL,
	`tier` integer DEFAULT 0 NOT NULL,
	`amount` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`user_id`, `scope`, `period`, `quest`, `tier`)
);
--> statement-breakpoint
INSERT INTO `__new_quest_claims`("user_id", "scope", "period", "quest", "tier", "amount", "created") -- Claims made before the ladder existed were all the first rung.
SELECT "user_id", "scope", "period", "quest", 0, "amount", "created" FROM `quest_claims`;--> statement-breakpoint
DROP TABLE `quest_claims`;--> statement-breakpoint
ALTER TABLE `__new_quest_claims` RENAME TO `quest_claims`;--> statement-breakpoint
PRAGMA foreign_keys=ON;