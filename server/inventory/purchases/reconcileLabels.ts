import {
  ensureInventoryItemLabels,
  getLocalPurchases,
  type LocalPurchaseWithLabels as LocalPurchaseRow,
} from "../db";
import { localPurchaseItems, getPurchaseItemManagementNo } from "./items";
import { labelsForPurchaseItem } from "./labels";

// 一覧読取中に余分な発注ラベルだけを数量に合わせる。削除対象の選択は既存DB関数に任せる。
export async function reconcileLocalPurchaseLabelQuantities(
  rows: LocalPurchaseRow[]
): Promise<LocalPurchaseRow[]> {
  let changed = false;

  for (const row of rows) {
    for (const item of localPurchaseItems(row)) {
      const desiredQuantity = Math.max(
        1,
        Math.floor(Number(item.quantity ?? row.quantity ?? 1)) || 1
      );
      const labels = labelsForPurchaseItem(row, item);
      if (labels.length <= desiredQuantity) continue;

      const rawInventoryId = Number(
        item.inventory_id ?? item.inventoryId ?? row.localInventoryId
      );
      const localInventoryId =
        Number.isFinite(rawInventoryId) && rawInventoryId > 0
          ? rawInventoryId
          : null;
      const managementNo =
        getPurchaseItemManagementNo(row, item) || row.managementNo || null;
      const title = String(item.title ?? row.title ?? "").trim();

      await ensureInventoryItemLabels({
        purchaseId: row.id,
        localInventoryId,
        legacyManagementNo: managementNo,
        title: title || row.title || managementNo || "商品",
        quantity: desiredQuantity,
        status: row.status === "purchased" ? "received" : "ordered",
        sourceKey: managementNo ? `management:${managementNo}` : null,
      });
      changed = true;
    }
  }

  return changed ? getLocalPurchases() : rows;
}
