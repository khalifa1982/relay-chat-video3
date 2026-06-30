CREATE TABLE `conference_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomId` varchar(40) NOT NULL,
	`dialedNumber` varchar(6),
	`partyCount` int NOT NULL DEFAULT 0,
	`startedAt` timestamp NOT NULL,
	`endedAt` timestamp NOT NULL,
	`durationSec` int NOT NULL DEFAULT 0,
	`participants` json,
	CONSTRAINT `conference_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conference_participants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conferenceId` int NOT NULL,
	`identityId` int NOT NULL,
	`number` varchar(6) NOT NULL,
	CONSTRAINT `conference_participants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_verifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`token` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_verifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_verif_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `identities` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `identities` ADD `statusOverride` varchar(16);--> statement-breakpoint
ALTER TABLE `identities` ADD `mobiles` text;--> statement-breakpoint
ALTER TABLE `identities` ADD `socials` text;--> statement-breakpoint
ALTER TABLE `identities` ADD `missedCallsSeenAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `emailVerified` boolean;--> statement-breakpoint
CREATE INDEX `conf_started_idx` ON `conference_history` (`startedAt`);--> statement-breakpoint
CREATE INDEX `conf_room_idx` ON `conference_history` (`roomId`);--> statement-breakpoint
CREATE INDEX `conf_part_identity_idx` ON `conference_participants` (`identityId`);--> statement-breakpoint
CREATE INDEX `conf_part_conf_idx` ON `conference_participants` (`conferenceId`);--> statement-breakpoint
CREATE INDEX `email_verif_user_idx` ON `email_verifications` (`userId`);