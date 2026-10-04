import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  getLocalPurchases,
  type LocalPurchaseWithLabels as LocalPurchaseRow,
} from "../db";
import {
  canRecoverOrphanLabelPurchase,
  getRecoveredPurchaseOverrides,
  recoveredPurchaseValueEquals,
  recoveredPurchaseJsonEquals,
  MAXIM_SECOND_LABEL_ID,
} from "./recoveryRules";
import { normalizePurchaseTrackingValue } from "./trackingFields";

export async function cleanupUnexpectedRepairedLocalPurchases(
  localPurchaseRows: LocalPurchaseRow[]
): Promise<LocalPurchaseRow[]> {
  const unexpectedRows = localPurchaseRows.filter(purchase => {
    if (purchase.stageUpdatedBy !== "system-repair") return false;
    const managementNo = String(purchase.managementNo ?? "").trim();
    return !canRecoverOrphanLabelPurchase(managementNo);
  });
  if (unexpectedRows.length === 0) return localPurchaseRows;

  const unexpectedIds = unexpectedRows
    .map(purchase => purchase.id)
    .filter(id => Number.isFinite(id));
  const unexpectedIdSet = new Set(unexpectedIds);
  const db = await getDb();
  if (db && unexpectedIds.length > 0) {
    const { inventoryItemLabels: labelTbl, localPurchases: purchaseTbl } =
      await import("../../../drizzle/schema");
    const { inArray } = await import("drizzle-orm");
    await db
      .update(labelTbl)
      .set({ purchaseId: null, status: "stocked" })
      .where(
        and(
          inArray(labelTbl.purchaseId, unexpectedIds),
          eq(labelTbl.status, "ordered")
        )
      );
    await db
      .update(labelTbl)
      .set({ purchaseId: null })
      .where(inArray(labelTbl.purchaseId, unexpectedIds));
    await db.delete(purchaseTbl).where(inArray(purchaseTbl.id, unexpectedIds));
  }

  return localPurchaseRows.filter(
    purchase => !unexpectedIdSet.has(purchase.id)
  );
}

export async function cleanupAllowedRecoveredPurchaseIssues(
  localPurchaseRows: LocalPurchaseRow[]
): Promise<LocalPurchaseRow[]> {
  const db = await getDb();
  if (!db) return localPurchaseRows;

  const { inventoryItemLabels: labelTbl, localPurchases: purchaseTbl } =
    await import("../../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  let changed = false;
  let nextRows = localPurchaseRows;

  const duplicateRows = nextRows
    .filter(
      purchase =>
        String(purchase.managementNo ?? "").trim() === "402_マキシム_1/2"
    )
    .sort((a, b) => a.id - b.id);
  const keepDuplicateRow = duplicateRows[0];
  const duplicateDeleteIds = duplicateRows
    .slice(1)
    .map(purchase => purchase.id);
  if (keepDuplicateRow && duplicateDeleteIds.length > 0) {
    await db
      .update(labelTbl)
      .set({ purchaseId: keepDuplicateRow.id })
      .where(inArray(labelTbl.purchaseId, duplicateDeleteIds));
    await db
      .delete(purchaseTbl)
      .where(inArray(purchaseTbl.id, duplicateDeleteIds));
    const deleteIdSet = new Set(duplicateDeleteIds);
    nextRows = nextRows.filter(purchase => !deleteIdSet.has(purchase.id));
    changed = true;
  }

  const maximSecondRows = nextRows
    .filter(
      purchase =>
        String(purchase.managementNo ?? "").trim() === "402_マキシム_2/2"
    )
    .sort((a, b) => a.id - b.id);
  const maximSecondRow = maximSecondRows[0] ?? null;
  const maximSecondOverrides =
    getRecoveredPurchaseOverrides("402_マキシム_2/2");
  if (maximSecondRow) {
    const title = maximSecondOverrides.title ?? maximSecondRow.title ?? "";
    const category =
      maximSecondOverrides.category ?? maximSecondRow.category ?? null;
    const quantity = Math.max(
      1,
      Number(maximSecondOverrides.quantity ?? maximSecondRow.quantity ?? 1) || 1
    );
    const unitPrice =
      maximSecondOverrides.unitPrice ?? maximSecondRow.unitPrice ?? null;
    const existingTrackingNumber = normalizePurchaseTrackingValue(
      maximSecondRow.trackingNumber
    );
    const existingShipDate = normalizePurchaseTrackingValue(
      maximSecondRow.shipDate
    );
    const existingCarrier = normalizePurchaseTrackingValue(
      maximSecondRow.carrier
    );
    const existingNote = normalizePurchaseTrackingValue(maximSecondRow.note);
    const hasInboundTracking = existingTrackingNumber != null;
    const repairedStatus = hasInboundTracking ? "shipped" : "ordered";
    const repairedStage = hasInboundTracking
      ? "shipped"
      : (maximSecondOverrides.stage ?? "ordered");
    const itemsJson = JSON.stringify([
      {
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
      },
    ]);
    const desired = {
      purchaseNum:
        maximSecondOverrides.purchaseNum ?? maximSecondRow.purchaseNum,
      status: repairedStatus,
      itemsJson,
      title,
      category,
      quantity,
      unitPrice,
      managementNo: "402_マキシム_2/2",
      purchaseDate:
        maximSecondOverrides.purchaseDate ?? maximSecondRow.purchaseDate,
      receivedDate: null,
      shipDate: existingShipDate,
      trackingNumber: existingTrackingNumber,
      carrier: existingCarrier,
      note: existingNote,
      supplierName:
        maximSecondOverrides.supplierName ?? maximSecondRow.supplierName,
      stage: repairedStage,
      stageUpdatedBy: hasInboundTracking
        ? (maximSecondRow.stageUpdatedBy ?? "tracking-registration")
        : "system-repair",
    };
    const maximSecondNeedsUpdate =
      !recoveredPurchaseValueEquals(
        maximSecondRow.purchaseNum,
        desired.purchaseNum
      ) ||
      !recoveredPurchaseValueEquals(maximSecondRow.status, desired.status) ||
      !recoveredPurchaseJsonEquals(
        maximSecondRow.itemsJson,
        desired.itemsJson
      ) ||
      !recoveredPurchaseValueEquals(maximSecondRow.title, desired.title) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.category,
        desired.category
      ) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.quantity,
        desired.quantity
      ) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.unitPrice,
        desired.unitPrice
      ) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.managementNo,
        desired.managementNo
      ) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.purchaseDate,
        desired.purchaseDate
      ) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.receivedDate,
        desired.receivedDate
      ) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.shipDate,
        desired.shipDate
      ) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.trackingNumber,
        desired.trackingNumber
      ) ||
      !recoveredPurchaseValueEquals(maximSecondRow.carrier, desired.carrier) ||
      !recoveredPurchaseValueEquals(maximSecondRow.note, desired.note) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.supplierName,
        desired.supplierName
      ) ||
      !recoveredPurchaseValueEquals(maximSecondRow.stage, desired.stage) ||
      !recoveredPurchaseValueEquals(
        maximSecondRow.stageUpdatedBy,
        desired.stageUpdatedBy
      );
    if (maximSecondNeedsUpdate) {
      await db
        .update(purchaseTbl)
        .set({
          ...desired,
          stageUpdatedAt: hasInboundTracking
            ? (maximSecondRow.stageUpdatedAt ?? new Date())
            : new Date(),
        })
        .where(eq(purchaseTbl.id, maximSecondRow.id));
      changed = true;
    }
  }
  const maximSecondLabels = await db
    .select()
    .from(labelTbl)
    .where(eq(labelTbl.legacyManagementNo, "402_マキシム_2/2"));
  const sortedMaximSecondLabels = [...maximSecondLabels].sort((a, b) => {
    const aIsTargetLabel =
      String(a.labelId ?? "")
        .trim()
        .toUpperCase() === MAXIM_SECOND_LABEL_ID;
    const bIsTargetLabel =
      String(b.labelId ?? "")
        .trim()
        .toUpperCase() === MAXIM_SECOND_LABEL_ID;
    if (aIsTargetLabel !== bIsTargetLabel) return aIsTargetLabel ? -1 : 1;
    const timeA = new Date(a.createdAt ?? 0).getTime();
    const timeB = new Date(b.createdAt ?? 0).getTime();
    if (timeA !== timeB) return timeB - timeA;
    return Number(b.id) - Number(a.id);
  });
  const keepLabel = sortedMaximSecondLabels[0];
  const deleteLabelIds = sortedMaximSecondLabels
    .slice(1)
    .map(label => Number(label.id))
    .filter(id => Number.isFinite(id));
  if (deleteLabelIds.length > 0) {
    await db.delete(labelTbl).where(inArray(labelTbl.id, deleteLabelIds));
    changed = true;
  }
  if (maximSecondRow && keepLabel) {
    const targetLocalInventoryId =
      maximSecondRow.localInventoryId ?? keepLabel.localInventoryId;
    const keepLabelNeedsUpdate =
      Number(keepLabel.purchaseId) !== maximSecondRow.id ||
      String(keepLabel.status ?? "")
        .trim()
        .toLowerCase() !== "ordered" ||
      (targetLocalInventoryId != null &&
        Number(keepLabel.localInventoryId) !== Number(targetLocalInventoryId));
    if (keepLabelNeedsUpdate) {
      await db
        .update(labelTbl)
        .set({
          purchaseId: maximSecondRow.id,
          localInventoryId: targetLocalInventoryId,
          status: "ordered",
        })
        .where(eq(labelTbl.id, keepLabel.id));
      changed = true;
    }
  } else if (
    keepLabel &&
    String(keepLabel.status ?? "")
      .trim()
      .toLowerCase() !== "ordered"
  ) {
    await db
      .update(labelTbl)
      .set({ status: "ordered" })
      .where(eq(labelTbl.id, keepLabel.id));
    changed = true;
  }

  return changed ? getLocalPurchases() : nextRows;
}
