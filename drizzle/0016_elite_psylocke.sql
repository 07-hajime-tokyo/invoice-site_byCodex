CREATE TABLE `authorized_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `authorized_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `authorized_users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`displayName` varchar(100) NOT NULL,
	`code` varchar(100) NOT NULL,
	`keywords` varchar(500) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deleted_inventories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zaicoId` int NOT NULL,
	`title` varchar(500) NOT NULL,
	`category` varchar(200),
	`place` varchar(200),
	`quantity` varchar(50),
	`unit` varchar(50),
	`unitPrice` varchar(50),
	`etc` text,
	`snapshotJson` text NOT NULL,
	`deletedBy` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deleted_inventories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `delivery_histories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deliveryNo` varchar(200) NOT NULL,
	`zaicoDeliveryId` int,
	`itemsJson` text NOT NULL,
	`status` enum('success','error') NOT NULL,
	`errorMessage` text,
	`deletedInventoryIdsJson` text,
	`cancelledItemsJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `delivery_histories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domestic_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(500) NOT NULL,
	`unit_price` decimal(10,2),
	`supplier_name` varchar(200),
	`note` text,
	`sort_order` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `domestic_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fedex_shipments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deliveryNo` varchar(200) NOT NULL,
	`sheetName` varchar(100) NOT NULL,
	`shippingDate` varchar(20) NOT NULL,
	`trackingNumber` varchar(100) NOT NULL,
	`itemsJson` text NOT NULL,
	`spreadsheetStatus` enum('pending','success','error') NOT NULL DEFAULT 'pending',
	`spreadsheetError` text,
	`operatorName` varchar(200),
	`historyId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fedex_shipments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_extras` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zaicoInventoryId` int NOT NULL,
	`supplierUrl` text,
	`supplierName` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_extras_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_extras_zaicoInventoryId_unique` UNIQUE(`zaicoInventoryId`)
);
--> statement-breakpoint
CREATE TABLE `inventory_memos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zaicoInventoryId` int NOT NULL,
	`title` varchar(500),
	`changeType` varchar(20) NOT NULL,
	`quantityBefore` int,
	`quantityAfter` int,
	`quantityDelta` int,
	`memo` text,
	`operatorName` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_memos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_manual_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_no` varchar(50) NOT NULL,
	`title` varchar(500) NOT NULL DEFAULT '',
	`quantity` int NOT NULL DEFAULT 1,
	`unit_price` decimal(10,2),
	`sort_order` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoice_manual_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_memos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_key` varchar(50) NOT NULL,
	`color_key` varchar(200) NOT NULL,
	`memo` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoice_memos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `local_inventories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zaicoId` int,
	`title` varchar(500) NOT NULL,
	`category` varchar(200),
	`place` varchar(200),
	`quantity` int NOT NULL DEFAULT 0,
	`unit` varchar(50) DEFAULT '個',
	`unitPrice` decimal(10,2),
	`etc` text,
	`supplierUrl` text,
	`supplierName` varchar(200),
	`isDeleted` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_inventories_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_inventories_zaicoId_unique` UNIQUE(`zaicoId`)
);
--> statement-breakpoint
CREATE TABLE `local_purchases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zaicoId` bigint,
	`purchaseNum` varchar(100),
	`status` varchar(50) NOT NULL DEFAULT 'ordered',
	`itemsJson` text NOT NULL,
	`localInventoryId` int,
	`title` varchar(500),
	`category` varchar(200),
	`quantity` int NOT NULL DEFAULT 1,
	`unitPrice` decimal(10,2),
	`managementNo` varchar(200),
	`purchaseDate` varchar(20),
	`receivedDate` varchar(20),
	`shipDate` varchar(20),
	`trackingNumber` varchar(200),
	`carrier` varchar(50),
	`note` text,
	`supplierUrl` varchar(500),
	`supplierName` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_purchases_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_purchases_zaicoId_unique` UNIQUE(`zaicoId`)
);
--> statement-breakpoint
CREATE TABLE `manual_shipments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceNo` varchar(50) NOT NULL,
	`sheetName` varchar(100) NOT NULL,
	`shippingDate` varchar(20) NOT NULL,
	`trackingNumber` varchar(100) NOT NULL,
	`itemsJson` text NOT NULL,
	`operatorName` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `manual_shipments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monthly_domestic_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`year_month` varchar(7) NOT NULL,
	`domestic_product_id` int,
	`title` varchar(500) NOT NULL DEFAULT '',
	`quantity` int NOT NULL DEFAULT 1,
	`unit_price` decimal(10,2),
	`supplier_name` varchar(200),
	`note` text,
	`is_paid` int NOT NULL DEFAULT 0,
	`sort_order` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monthly_domestic_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monthly_report_costs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`report_id` int NOT NULL,
	`invoice_key` varchar(50) NOT NULL,
	`item_key` varchar(500) NOT NULL,
	`title` varchar(500),
	`quantity` int NOT NULL DEFAULT 0,
	`unit_price` decimal(10,2),
	`subtotal` decimal(12,2),
	`item_type` varchar(20) NOT NULL DEFAULT 'ordered',
	`is_manual` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monthly_report_costs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monthly_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`year_month` varchar(7) NOT NULL,
	`label` varchar(200),
	`inventory_summary_json` text,
	`invoice_list_json` text,
	`created_by` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monthly_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partner_message_threads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parentMessageId` int NOT NULL,
	`senderType` varchar(20) NOT NULL,
	`senderName` varchar(200) NOT NULL,
	`content` text NOT NULL,
	`isReadByPartner` int NOT NULL DEFAULT 0,
	`isReadByAdmin` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partner_message_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partner_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerCode` varchar(100) NOT NULL,
	`partnerName` varchar(200) NOT NULL,
	`fedexShipmentId` int,
	`message` text NOT NULL,
	`isRead` int NOT NULL DEFAULT 0,
	`replyText` text,
	`repliedAt` timestamp,
	`isDeleted` int NOT NULL DEFAULT 0,
	`isDeletedByPartner` int NOT NULL DEFAULT 0,
	`isReadByPartner` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partner_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partner_portals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerCode` varchar(100) NOT NULL,
	`partnerName` varchar(200) NOT NULL,
	`sheetName` varchar(100) NOT NULL,
	`password` varchar(200) NOT NULL,
	`sessionToken` varchar(200),
	`sessionExpiresAt` timestamp,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partner_portals_id` PRIMARY KEY(`id`),
	CONSTRAINT `partner_portals_partnerCode_unique` UNIQUE(`partnerCode`)
);
--> statement-breakpoint
CREATE TABLE `purchase_extras` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zaicoId` int NOT NULL,
	`shipDate` varchar(20),
	`trackingNumber` varchar(200),
	`carrier` varchar(50),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `purchase_extras_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_extras_zaicoId_unique` UNIQUE(`zaicoId`)
);
--> statement-breakpoint
CREATE TABLE `purchase_histories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zaicoId` int NOT NULL,
	`kanriNo` varchar(200),
	`title` varchar(500) NOT NULL,
	`category` varchar(200),
	`supplier` varchar(200),
	`quantity` varchar(50) NOT NULL,
	`unitPrice` varchar(50),
	`purchaseDate` varchar(20) NOT NULL,
	`inventoryId` int,
	`cancelled` int NOT NULL DEFAULT 0,
	`operatorName` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchase_histories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shipment_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fedexShipmentId` int NOT NULL,
	`itemIndex` int NOT NULL,
	`isChecked` int NOT NULL DEFAULT 0,
	`partnerCode` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shipment_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(100) NOT NULL,
	`value` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
ALTER TABLE `trade_records` ADD `customsDuty` decimal(14,4);