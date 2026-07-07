CREATE TABLE `push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`identityId` int NOT NULL,
	`endpoint` varchar(500) NOT NULL,
	`p256dh` varchar(255) NOT NULL,
	`auth` varchar(120) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_sub_endpoint_unique` UNIQUE(`endpoint`)
);
--> statement-breakpoint
CREATE INDEX `push_sub_identity_idx` ON `push_subscriptions` (`identityId`);