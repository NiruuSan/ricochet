-- Security reset mutations are batched by lib/security-admin.ts.
CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`action` text NOT NULL,
	`target_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_recent` ON `admin_audit` (`created`);--> statement-breakpoint
CREATE TABLE `security_holds` (
	`user_id` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`until` integer NOT NULL,
	`created_by` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
-- Serialize the hold check with transfer creation and balance reservation.
CREATE TRIGGER security_hold_withdrawal BEFORE INSERT ON cash_transfers
WHEN NEW.kind = 'withdrawal' AND EXISTS (
  SELECT 1 FROM security_holds WHERE user_id = NEW.user_id AND "until" > NEW.created
)
BEGIN
  SELECT RAISE(ABORT, 'security withdrawal hold');
END;
