CREATE TABLE `run_shots` (
	`run_key` text NOT NULL,
	`revision` integer NOT NULL,
	`angle` real,
	`created` integer NOT NULL,
	PRIMARY KEY(`run_key`, `revision`)
);
