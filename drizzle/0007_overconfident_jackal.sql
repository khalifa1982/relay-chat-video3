ALTER TABLE `push_subscriptions` ADD `kind` varchar(10);--> statement-breakpoint
ALTER TABLE `users` ADD `loginPinHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `loginPinAttempts` int;--> statement-breakpoint
ALTER TABLE `users` ADD `loginPinLockedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `preferPinLogin` boolean;