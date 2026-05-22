CREATE TABLE `verified_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`verifiedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verified_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `verified_users_openId_unique` UNIQUE(`openId`)
);
