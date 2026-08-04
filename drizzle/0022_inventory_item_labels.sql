CREATE TABLE IF NOT EXISTS `inventory_item_labels` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `labelId` varchar(7) NOT NULL,
  `purchaseId` int,
  `localInventoryId` int,
  `legacyManagementNo` varchar(200),
  `title` varchar(500) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'ordered',
  `sourceKey` varchar(255),
  `receivedAt` timestamp NULL,
  `shippedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `inventory_item_labels_labelId_unique` UNIQUE(`labelId`),
  INDEX `idx_inventory_item_labels_purchase_id` (`purchaseId`),
  INDEX `idx_inventory_item_labels_inventory_id` (`localInventoryId`),
  INDEX `idx_inventory_item_labels_legacy_management_no` (`legacyManagementNo`),
  INDEX `idx_inventory_item_labels_source_key` (`sourceKey`)
);
