import { getDb } from "../../db";
import {
  getLocalPurchases,
  type LocalPurchaseWithLabels as LocalPurchaseRow,
} from "../db";
import { localPurchaseMatchesInventoryLabel } from "./labelMatching";
import {
  positiveHistoryNumber,
  firstPurchaseHistoryEtcPart,
  parseLocalPurchaseItems,
} from "./legacyValues";
import {
  buildPurchaseTrackingUpdate,
  hasOwnPurchaseTrackingField,
  type PurchaseTrackingSyncInput,
} from "./trackingFields";
import {
  getPurchaseTrackingAuditState,
  getNextPurchaseTrackingAuditState,
  getPurchaseTrackingChangedFields,
  recordPurchaseTrackingAuditLog,
} from "./trackingAudit";

export function localPurchaseMatchesTrackingTarget(
  row: LocalPurchaseRow,
  input: PurchaseTrackingSyncInput
): boolean {
  if (row.id === input.zaicoId || row.zaicoId === input.zaicoId) return true;
  const labelId = String(input.labelId ?? "")
    .trim()
    .toUpperCase();
  if (
    labelId &&
    (row.itemLabels ?? []).some(
      label =>
        String(label.labelId ?? "")
          .trim()
          .toUpperCase() === labelId
    )
  ) {
    return true;
  }

  const inventoryId = positiveHistoryNumber(input.inventoryId);
  const managementNo = firstPurchaseHistoryEtcPart(input.managementNo);
  if (
    inventoryId != null &&
    localPurchaseMatchesInventoryLabel(row, inventoryId, managementNo)
  )
    return true;
  if (!managementNo) return false;
  if (firstPurchaseHistoryEtcPart(row.managementNo) === managementNo)
    return true;
  return parseLocalPurchaseItems(row).some(
    item => firstPurchaseHistoryEtcPart(item.etc) === managementNo
  );
}

export async function syncLocalPurchaseTrackingFromExtra(
  input: PurchaseTrackingSyncInput
) {
  const db = await getDb();
  if (!db) return { updatedCount: 0, targetIds: [] as number[] };
  const { localPurchases: lpTbl } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const trackingNumberWasProvided = hasOwnPurchaseTrackingField(
    input,
    "trackingNumber"
  );
  const trackingUpdate = buildPurchaseTrackingUpdate(input);
  if (Object.keys(trackingUpdate).length === 0)
    return { updatedCount: 0, targetIds: [] as number[] };
  const hasTrackingNumber =
    String(trackingUpdate.trackingNumber ?? "").trim().length > 0;
  const localPurchases = await getLocalPurchases();
  const directMatches = localPurchases.filter(
    row => row.id === input.zaicoId || row.zaicoId === input.zaicoId
  );
  const targets =
    directMatches.length > 0
      ? directMatches
      : localPurchases.filter(row =>
          localPurchaseMatchesTrackingTarget(row, input)
        );
  const uniqueTargets = Array.from(
    new Map(targets.map(row => [row.id, row])).values()
  );

  for (const purchase of uniqueTargets) {
    const updateData: Partial<typeof lpTbl.$inferInsert> = {
      ...trackingUpdate,
      stageUpdatedBy: "tracking-registration",
      stageUpdatedAt: new Date(),
    };
    if (purchase.status !== "purchased" && trackingNumberWasProvided) {
      if (hasTrackingNumber) {
        updateData.status = "shipped";
        updateData.stage = "shipped";
      } else if (purchase.status === "shipped") {
        updateData.status = "ordered";
        updateData.stage = "ordered";
      }
    }
    const previousAuditState = getPurchaseTrackingAuditState(purchase);
    const nextAuditState = getNextPurchaseTrackingAuditState(
      previousAuditState,
      updateData
    );
    const changedFields = getPurchaseTrackingChangedFields(
      previousAuditState,
      nextAuditState
    );
    await db.update(lpTbl).set(updateData).where(eq(lpTbl.id, purchase.id));
    await recordPurchaseTrackingAuditLog(
      input,
      purchase,
      previousAuditState,
      nextAuditState,
      changedFields
    );
  }

  return {
    updatedCount: uniqueTargets.length,
    targetIds: uniqueTargets.map(purchase => purchase.id),
  };
}
