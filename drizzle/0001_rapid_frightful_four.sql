CREATE TABLE `attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storageKey` varchar(256) NOT NULL,
	`url` text NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`sizeBytes` bigint NOT NULL,
	`width` smallint,
	`height` smallint,
	`durationMs` int,
	`filename` varchar(256),
	`uploadedByIdentityId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `call_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callerIdentityId` int NOT NULL,
	`calleeIdentityId` int NOT NULL,
	`conversationId` int,
	`status` enum('initiated','ringing','answered','missed','declined','ended','failed') NOT NULL DEFAULT 'initiated',
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`answeredAt` timestamp,
	`endedAt` timestamp,
	`durationSec` int,
	`channel` enum('voice','video') NOT NULL DEFAULT 'video',
	CONSTRAINT `call_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`number` varchar(6) NOT NULL,
	`displayName` varchar(64),
	`avatarUrl` text,
	`favourite` boolean NOT NULL DEFAULT false,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contacts_owner_number_unique` UNIQUE(`ownerId`,`number`)
);
--> statement-breakpoint
CREATE TABLE `conversation_participants` (
	`conversationId` int NOT NULL,
	`identityId` int NOT NULL,
	`unreadCount` int NOT NULL DEFAULT 0,
	`lastReadMessageId` int,
	`mutedUntil` timestamp,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversation_participants_conversationId_identityId_pk` PRIMARY KEY(`conversationId`,`identityId`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pairKey` varchar(64),
	`kind` enum('dm','group') NOT NULL DEFAULT 'dm',
	`title` varchar(128),
	`lastMessageAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversations_pairKey_unique` UNIQUE(`pairKey`)
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(6) NOT NULL,
	`displayName` varchar(64) NOT NULL,
	`avatarUrl` text,
	`userId` int,
	`guestToken` varchar(64),
	`guestExpiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `identities_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`senderIdentityId` int NOT NULL,
	`kind` enum('text','image','video','audio','file','system') NOT NULL DEFAULT 'text',
	`body` text,
	`attachmentId` int,
	`replyToId` int,
	`meta` json,
	`status` enum('sent','delivered','read','failed') NOT NULL DEFAULT 'sent',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`editedAt` timestamp,
	`deletedAt` timestamp,
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `presence` (
	`identityId` int NOT NULL,
	`isOnline` boolean NOT NULL DEFAULT false,
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`socketSessionId` varchar(64),
	CONSTRAINT `presence_identityId` PRIMARY KEY(`identityId`)
);
--> statement-breakpoint
CREATE TABLE `signaling` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromIdentityId` int NOT NULL,
	`toIdentityId` int NOT NULL,
	`callId` varchar(64) NOT NULL,
	`kind` enum('offer','answer','ice','hangup','ringing','decline') NOT NULL,
	`payload` json NOT NULL,
	`consumed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `signaling_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `attachments_owner_idx` ON `attachments` (`uploadedByIdentityId`);--> statement-breakpoint
CREATE INDEX `call_caller_idx` ON `call_history` (`callerIdentityId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `call_callee_idx` ON `call_history` (`calleeIdentityId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `contacts_owner_idx` ON `contacts` (`ownerId`);--> statement-breakpoint
CREATE INDEX `cp_identity_idx` ON `conversation_participants` (`identityId`);--> statement-breakpoint
CREATE INDEX `conversations_lastMessage_idx` ON `conversations` (`lastMessageAt`);--> statement-breakpoint
CREATE INDEX `identities_userId_idx` ON `identities` (`userId`);--> statement-breakpoint
CREATE INDEX `identities_guestToken_idx` ON `identities` (`guestToken`);--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `messages_sender_idx` ON `messages` (`senderIdentityId`);--> statement-breakpoint
CREATE INDEX `presence_isOnline_idx` ON `presence` (`isOnline`);--> statement-breakpoint
CREATE INDEX `signaling_inbox_idx` ON `signaling` (`toIdentityId`,`consumed`,`createdAt`);--> statement-breakpoint
CREATE INDEX `signaling_call_idx` ON `signaling` (`callId`);--> statement-breakpoint
CREATE INDEX `signaling_expires_idx` ON `signaling` (`expiresAt`);