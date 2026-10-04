import type { LocalPurchase } from "../../../drizzle/schema";
import {
  isReceivedLabelStatus,
  type InventoryItemLabelView,
} from "../labelViews";
import { localPurchaseLabelViews, type PurchaseLabelSource } from "./labels";
import { localPurchaseItems, getPurchaseItemManagementNo } from "./items";

export type PurchaseStatusSource = PurchaseLabelSource &
  Pick<LocalPurchase, "id" | "zaicoId" | "status" | "trackingNumber">;

// 既存の復旧データ向け例外。発送表示より後、入庫履歴・ラベル判定より前に適用する。
const ORDERED_RECOVERED_PURCHASE_MANAGEMENT_NOS = new Set(["402_マキシム_2/2"]);

export function isLocalPurchaseReceivedFromLabels(
  row: PurchaseStatusSource,
  inventoryLabelMap?: Map<number, InventoryItemLabelView[]>
): boolean {
  if (row.status === "purchased") return true;
  const labels = localPurchaseLabelViews(row, inventoryLabelMap);
  if (labels.length === 0) return false;
  const requiredQuantity = Math.max(
    1,
    Math.floor(Number(row.quantity ?? 1)) || 1
  );
  const receivedCount = labels.filter(label =>
    isReceivedLabelStatus(label.status)
  ).length;
  return receivedCount >= Math.min(requiredQuantity, labels.length);
}

export function getLocalPurchaseDisplayStatus(
  row: PurchaseStatusSource,
  inventoryLabelMap?: Map<number, InventoryItemLabelView[]>,
  purchasedZaicoIds?: Set<number>
): string {
  if (
    row.status !== "purchased" &&
    (String(row.trackingNumber ?? "").trim() || row.status === "shipped")
  ) {
    return "shipped";
  }
  if (shouldKeepRecoveredPurchaseOrdered(row)) return "ordered";
  const localId = row.zaicoId ?? row.id;
  if (
    row.status === "purchased" ||
    (purchasedZaicoIds?.has(localId) ?? false) ||
    isLocalPurchaseReceivedFromLabels(row, inventoryLabelMap)
  ) {
    return "purchased";
  }
  return row.status || "ordered";
}

export function shouldKeepRecoveredPurchaseOrdered(
  row: PurchaseStatusSource
): boolean {
  const rowManagementNo = String(row.managementNo ?? "").trim();
  if (ORDERED_RECOVERED_PURCHASE_MANAGEMENT_NOS.has(rowManagementNo))
    return true;
  return localPurchaseItems(row).some(item =>
    ORDERED_RECOVERED_PURCHASE_MANAGEMENT_NOS.has(
      getPurchaseItemManagementNo(row, item)
    )
  );
}
