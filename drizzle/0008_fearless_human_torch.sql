CREATE TABLE `online_watches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`watcherId` int NOT NULL,
	`targetId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `online_watches_id` PRIMARY KEY(`id`),
	CONSTRAINT `watch_pair_unique` UNIQUE(`watcherId`,`targetId`)
);
--> statement-breakpoint
CREATE TABLE `party_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(6) NOT NULL,
	`ownerIdentityId` int NOT NULL,
	`title` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `party_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `party_lines_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
ALTER TABLE `attachments` ADD `thumbKey` varchar(256);--> statement-breakpoint
ALTER TABLE `attachments` ADD `thumbUrl` text;--> statement-breakpoint
CREATE INDEX `watch_target_idx` ON `online_watches` (`targetId`);--> statement-breakpoint
CREATE INDEX `party_lines_owner_idx` ON `party_lines` (`ownerIdentityId`);--> statement-breakpoint
CREATE INDEX `contacts_number_idx` ON `contacts` (`number`);--> statement-breakpoint
CREATE INDEX `messages_convo_id_idx` ON `messages` (`conversationId`,`id`);--> statement-breakpoint
CREATE INDEX `messages_attachment_idx` ON `messages` (`attachmentId`);