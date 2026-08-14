ALTER TABLE `outbound_boxes`
  ADD COLUMN `trackingUnlinkedAt` timestamp NULL,
  ADD COLUMN `unsealedAt` timestamp NULL;

ALTER TABLE `fedex_shipments`
  ADD COLUMN `cancelledAt` timestamp NULL,
  ADD COLUMN `cancellationReason` varchar(500) NULL;

CREATE TABLE `defective_listing_groups` (
  `id` int AUTO_INCREMENT NOT NULL,
  `groupCode` varchar(32) NOT NULL,
  `status` enum('active','dissolved') NOT NULL DEFAULT 'active',
  `memberLabelIdsJson` text NOT NULL,
  `createdBy` varchar(200),
  `sheetSyncedAt` timestamp NULL,
  `dissolvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `defective_listing_groups_id` PRIMARY KEY(`id`),
  CONSTRAINT `defective_listing_groups_groupCode_unique` UNIQUE(`groupCode`)
);
