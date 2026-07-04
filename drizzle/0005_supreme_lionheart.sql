CREATE TABLE `email_otps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`codeHash` varchar(255) NOT NULL,
	`purpose` varchar(16) NOT NULL DEFAULT 'login',
	`firstName` varchar(64),
	`lastName` varchar(64),
	`expiresAt` timestamp NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_otps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `category` varchar(16);--> statement-breakpoint
ALTER TABLE `contacts` ADD `blocked` boolean;--> statement-breakpoint
ALTER TABLE `identities` ADD `verified` boolean;--> statement-breakpoint
ALTER TABLE `identities` ADD `firstName` varchar(64);--> statement-breakpoint
ALTER TABLE `identities` ADD `lastName` varchar(64);--> statement-breakpoint
ALTER TABLE `identities` ADD `historyClearedAt` timestamp;--> statement-breakpoint
CREATE INDEX `email_otps_email_idx` ON `email_otps` (`email`);--> statement-breakpoint
CREATE INDEX `email_otps_expires_idx` ON `email_otps` (`expiresAt`);