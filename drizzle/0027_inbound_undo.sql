ALTER TABLE `inventory_item_labels`
  ADD COLUMN `inspectionOutcome` varchar(32) NULL,
  ADD COLUMN `replacementRequested` boolean NULL,
  ADD COLUMN `inspectionSourceInventoryId` int NULL,
  ADD COLUMN `inspectionInventoryId` int NULL,
  ADD COLUMN `inspectionQuantityDelta` int NULL,
  ADD COLUMN `inspectionPurchaseHistoryId` int NULL,
  ADD COLUMN `inspectionActionItemId` int NULL,
  ADD COLUMN `inspectedAt` timestamp NULL,
  ADD COLUMN `inspectionCancelledAt` timestamp NULL,
  ADD COLUMN `inspectionCancelledBy` varchar(200) NULL;
