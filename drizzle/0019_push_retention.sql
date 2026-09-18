CREATE TABLE `analytics_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `player_activity` (
	`user_id` text NOT NULL,
	`day` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_day` ON `player_activity` (`day`);--> statement-breakpoint
CREATE TABLE `push_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`match_id` text NOT NULL,
	`created` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`sent` integer,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_pending` ON `push_deliveries` (`sent`,`next_attempt`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_endpoint` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_owner` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `player_created` ON `players` (`created`);
--> statement-breakpoint
INSERT INTO analytics_metadata(key, value) VALUES('started', CAST(unixepoch('subsec') * 1000 AS INTEGER));
--> statement-breakpoint
CREATE TRIGGER activity_signup AFTER INSERT ON players BEGIN
  INSERT OR IGNORE INTO player_activity(user_id, day) VALUES(NEW.id, CAST(NEW.created / 86400000 AS INTEGER) * 86400000);
END;
--> statement-breakpoint
CREATE TRIGGER activity_presence AFTER UPDATE OF last_seen ON players
WHEN NEW.last_seen > OLD.last_seen BEGIN
  INSERT OR IGNORE INTO player_activity(user_id, day) VALUES(NEW.id, CAST(NEW.last_seen / 86400000 AS INTEGER) * 86400000);
END;
--> statement-breakpoint
CREATE TRIGGER push_opponent_finished AFTER UPDATE OF done ON runs
WHEN OLD.done = 0 AND NEW.done = 1 BEGIN
  INSERT OR IGNORE INTO push_deliveries(id, subscription_id, match_id, created)
    SELECT NEW.id || ':' || s.id, s.id, NEW.match_id, COALESCE(NEW.finished, CAST(unixepoch('subsec') * 1000 AS INTEGER))
    FROM matches m JOIN push_subscriptions s ON s.user_id = CASE WHEN m.p1 = NEW.user_id THEN m.p2 ELSE m.p1 END
    WHERE m.id = NEW.match_id AND m.cancelled = 0;
END;
