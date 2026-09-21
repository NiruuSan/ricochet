ALTER TABLE `shot_analysis` ADD `angle` real;--> statement-breakpoint
-- The angle each analysed shot was played at is already kept with the shot
-- itself, so the variety check works on the history as well as on new play.
UPDATE `shot_analysis` SET `angle` = (SELECT `angle` FROM `run_shots` WHERE `run_shots`.`run_key` = `shot_analysis`.`run_key` AND `run_shots`.`revision` = `shot_analysis`.`revision`) WHERE `angle` IS NULL;
