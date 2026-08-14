ALTER TABLE `inventory_item_labels`
  ADD COLUMN `defectTags` varchar(255) NULL,
  ADD COLUMN `defectNote` varchar(500) NULL,
  ADD COLUMN `defectPhotosJson` text NULL,
  ADD COLUMN `defectRecordedAt` timestamp NULL,
  ADD COLUMN `yahooClosedPricesJson` text NULL,
  ADD COLUMN `yahooPriceFetchedAt` timestamp NULL,
  ADD COLUMN `defectiveSheetSyncedAt` timestamp NULL;
