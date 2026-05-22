CREATE TABLE `ai_chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role` varchar(16) NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_knowledge` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int,
	`sourceType` varchar(32) NOT NULL,
	`sourceLabel` varchar(255),
	`content` text NOT NULL,
	`dateRange` varchar(64),
	`imageUrl` text,
	`imageKey` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_knowledge_id` PRIMARY KEY(`id`)
);
