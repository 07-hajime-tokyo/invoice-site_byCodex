ALTER TABLE `invoice_items` ADD `tax` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `logoUrl` text;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `logoKey` varchar(512);--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `taxRate` decimal(5,2) DEFAULT '0';