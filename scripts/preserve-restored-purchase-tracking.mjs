import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "server/inventory/routers.ts");
const source = readFileSync(target, "utf8");
const eol = source.includes("\r\n") ? "\r\n" : "\n";
const normalized = source.replace(/\r\n/g, "\n");

const oldSnippet = `    const unitPrice = maximSecondOverrides.unitPrice ?? maximSecondRow.unitPrice ?? null;
    const itemsJson = JSON.stringify([{
      id: 1,
      inventory_id: maximSecondRow.localInventoryId,
      inventoryId: maximSecondRow.localInventoryId,
      title,
      quantity: String(quantity),
      unit_price: unitPrice,
      unitPrice,
      etc: "402_マキシム_2/2",
      category,
      status: "ordered",
    }]);
    await db
      .update(purchaseTbl)
      .set({
        purchaseNum: maximSecondOverrides.purchaseNum ?? maximSecondRow.purchaseNum,
        status: "ordered",
        itemsJson,
        title,
        category,
        quantity,
        unitPrice,
        managementNo: "402_マキシム_2/2",
        purchaseDate: maximSecondOverrides.purchaseDate ?? maximSecondRow.purchaseDate,
        receivedDate: null,
        trackingNumber: null,
        carrier: null,
        supplierName: maximSecondOverrides.supplierName ?? maximSecondRow.supplierName,
        stage: maximSecondOverrides.stage ?? "ordered",
        stageUpdatedBy: "system-repair",
        stageUpdatedAt: new Date(),`;

const newSnippet = `    const unitPrice = maximSecondOverrides.unitPrice ?? maximSecondRow.unitPrice ?? null;
    const existingTrackingNumber = normalizePurchaseTrackingValue(maximSecondRow.trackingNumber);
    const existingShipDate = normalizePurchaseTrackingValue(maximSecondRow.shipDate);
    const existingCarrier = normalizePurchaseTrackingValue(maximSecondRow.carrier);
    const existingNote = normalizePurchaseTrackingValue(maximSecondRow.note);
    const hasInboundTracking = existingTrackingNumber != null;
    const repairedStatus = hasInboundTracking ? "shipped" : "ordered";
    const repairedStage = hasInboundTracking ? "shipped" : maximSecondOverrides.stage ?? "ordered";
    const itemsJson = JSON.stringify([{
      id: 1,
      inventory_id: maximSecondRow.localInventoryId,
      inventoryId: maximSecondRow.localInventoryId,
      title,
      quantity: String(quantity),
      unit_price: unitPrice,
      unitPrice,
      etc: "402_マキシム_2/2",
      category,
      status: repairedStatus,
    }]);
    await db
      .update(purchaseTbl)
      .set({
        purchaseNum: maximSecondOverrides.purchaseNum ?? maximSecondRow.purchaseNum,
        status: repairedStatus,
        itemsJson,
        title,
        category,
        quantity,
        unitPrice,
        managementNo: "402_マキシム_2/2",
        purchaseDate: maximSecondOverrides.purchaseDate ?? maximSecondRow.purchaseDate,
        receivedDate: null,
        shipDate: existingShipDate,
        trackingNumber: existingTrackingNumber,
        carrier: existingCarrier,
        note: existingNote,
        supplierName: maximSecondOverrides.supplierName ?? maximSecondRow.supplierName,
        stage: repairedStage,
        stageUpdatedBy: hasInboundTracking ? maximSecondRow.stageUpdatedBy ?? "tracking-registration" : "system-repair",
        stageUpdatedAt: hasInboundTracking ? maximSecondRow.stageUpdatedAt ?? new Date() : new Date(),`;

if (normalized.includes(newSnippet)) {
  console.log("[preserve-restored-purchase-tracking] already applied");
} else if (normalized.includes(oldSnippet)) {
  writeFileSync(target, normalized.replace(oldSnippet, newSnippet).replace(/\n/g, eol));
  console.log("[preserve-restored-purchase-tracking] applied");
} else {
  throw new Error("Could not find restored purchase tracking block to patch.");
}
