CREATE TABLE `invoice_number_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` int NOT NULL,
	`source` varchar(32) NOT NULL,
	`rawValue` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoice_number_history_id` PRIMARY KEY(`id`)
);
