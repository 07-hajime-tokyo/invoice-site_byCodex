-- やることリスト専用のスクリーンショット添付。
-- 出品写真とは用途が違うため、listing_photos とは分離して保存する。
CREATE TABLE IF NOT EXISTS `action_item_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `actionItemId` int NOT NULL,
  `fileName` varchar(255) NULL,
  `contentType` varchar(100) NOT NULL,
  `dataBase64` mediumtext NOT NULL,
  `createdBy` varchar(200) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_action_item_attachments_item` (`actionItemId`),
  INDEX `idx_action_item_attachments_created` (`createdAt`)
);
