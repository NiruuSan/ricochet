CREATE TABLE `bug_report_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`report_id` text,
	`pathname` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bug_attachment_user` ON `bug_report_attachments` (`user_id`);--> statement-breakpoint
CREATE INDEX `bug_attachment_report` ON `bug_report_attachments` (`report_id`);--> statement-breakpoint
CREATE INDEX `bug_attachment_created` ON `bug_report_attachments` (`created`);