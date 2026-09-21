CREATE TABLE `bug_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`page` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	CONSTRAINT "bug_report_status" CHECK("bug_reports"."status" IN ('open', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX `bug_report_user` ON `bug_reports` (`user_id`);--> statement-breakpoint
CREATE INDEX `bug_report_created` ON `bug_reports` (`created`,`id`);