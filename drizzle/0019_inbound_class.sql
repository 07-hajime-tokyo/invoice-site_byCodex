ALTER TABLE `local_purchases` ADD `inboundClass` varchar(20);--> statement-breakpoint
ALTER TABLE `local_purchases` ADD `classSource` varchar(10) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_purchases` ADD `stage` varchar(20) DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_purchases` ADD `stageUpdatedBy` varchar(100);--> statement-breakpoint
ALTER TABLE `local_purchases` ADD `stageUpdatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `local_purchases` ADD `shaftParentPurchaseId` int;
