ALTER TABLE `identities` ADD `deviceId` varchar(64);--> statement-breakpoint
CREATE INDEX `identities_deviceId_idx` ON `identities` (`deviceId`);