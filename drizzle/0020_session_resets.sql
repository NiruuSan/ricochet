CREATE TABLE `session_resets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`invalid_before` integer NOT NULL,
	`created` integer NOT NULL
);
