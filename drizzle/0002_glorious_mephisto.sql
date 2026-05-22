CREATE TABLE `invoice_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`senderName` varchar(255),
	`senderCompany` varchar(255),
	`senderEmail` varchar(320),
	`senderPhone` varchar(64),
	`senderAddress` text,
	`senderCity` varchar(128),
	`senderCountry` varchar(128),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoice_settings_id` PRIMARY KEY(`id`)
);
