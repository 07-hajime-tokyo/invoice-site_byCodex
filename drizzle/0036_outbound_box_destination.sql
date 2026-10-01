ALTER TABLE `outbound_boxes`
  ADD COLUMN `destinationSheetName` varchar(50) NULL AFTER `fedexShipmentId`;
