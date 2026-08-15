CREATE TABLE IF NOT EXISTS `outbound_boxes` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `boxCode` varchar(16) NOT NULL,
  `status` enum('open','sealed','shipped') NOT NULL DEFAULT 'open',
  `deliveryHistoryId` int,
  `trackingNumber` varchar(100),
  `fedexShipmentId` int,
  `operatorName` varchar(200),
  `openedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sealedAt` timestamp NULL,
  `linkedAt` timestamp NULL,
  `discardedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `outbound_boxes_boxCode_unique` UNIQUE (`boxCode`),
  INDEX `idx_outbound_boxes_status` (`status`),
  INDEX `idx_outbound_boxes_delivery_history` (`deliveryHistoryId`),
  INDEX `idx_outbound_boxes_tracking` (`trackingNumber`),
  INDEX `idx_outbound_boxes_discarded` (`discardedAt`)
);

-- TiDBは同一ALTER内での「列追加＋その列へのインデックス追加」を受け付けないため2文に分ける
ALTER TABLE `inventory_item_labels`
  ADD COLUMN `outboundBoxId` int NULL AFTER `sourceKey`;

ALTER TABLE `inventory_item_labels`
  ADD INDEX `idx_inventory_item_labels_outbound_box` (`outboundBoxId`);
