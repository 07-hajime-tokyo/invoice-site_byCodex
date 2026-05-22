CREATE TABLE `whatsapp_chat_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(255) NOT NULL,
	`type` varchar(32) NOT NULL,
	`fileName` varchar(255),
	`imageUrl` text,
	`imageKey` varchar(512),
	`textContent` text,
	`mimeType` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsapp_chat_history_id` PRIMARY KEY(`id`)
);
