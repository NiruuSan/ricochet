ALTER TABLE `players` ADD `public_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `player_public_id_unique` ON `players` (`public_id`);
--> statement-breakpoint
UPDATE players SET public_id = lower(hex(randomblob(16))) WHERE public_id IS NULL;
--> statement-breakpoint
CREATE TRIGGER player_public_id AFTER INSERT ON players WHEN NEW.public_id IS NULL
BEGIN UPDATE players SET public_id = lower(hex(randomblob(16))) WHERE id = NEW.id; END;
