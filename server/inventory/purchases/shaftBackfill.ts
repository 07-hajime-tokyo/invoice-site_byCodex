import { getEbayStockType } from "@shared/ebayInventory";
import { getInventoryManagementNo } from "../managementNo";
import {
  getLocalPurchases,
  upsertLocalPurchase,
  type LocalPurchaseWithLabels as LocalPurchaseRow,
  type LocalInventoryWithLabels as LocalInventoryRow,
} from "../db";

// 在庫だけが残ったシャフト商品の発注を補完する。手動のシャフト分離操作とは別の処理。
function getInventoryEtcPart(etc: string | null | undefined, index: number) {
  return (
    String(etc ?? "")
      .split(",")
      [index]?.trim() ?? ""
  );
}

export async function ensureShaftPurchases(
  localPurchaseRows: LocalPurchaseRow[],
  localInventoryRows: LocalInventoryRow[]
): Promise<LocalPurchaseRow[]> {
  const existingManagementNos = new Set<string>();
  for (const purchase of localPurchaseRows) {
    const purchaseManagementNo = String(purchase.managementNo ?? "").trim();
    if (purchaseManagementNo) existingManagementNos.add(purchaseManagementNo);
    try {
      const items = JSON.parse(purchase.itemsJson ?? "[]");
      if (Array.isArray(items)) {
        for (const item of items) {
          const itemManagementNo =
            String(item?.etc ?? "")
              .split(",")[0]
              ?.trim() ?? "";
          if (itemManagementNo) existingManagementNos.add(itemManagementNo);
        }
      }
    } catch {
      // ignore malformed legacy JSON
    }
  }

  const missingShaftInventories = localInventoryRows.filter(inventory => {
    if (inventory.isDeleted) return false;
    if (getEbayStockType(inventory.etc) !== "shaft") return false;
    const managementNo = getInventoryManagementNo(inventory.etc);
    return managementNo && !existingManagementNos.has(managementNo);
  });

  if (missingShaftInventories.length === 0) return localPurchaseRows;

  let repaired = false;
  for (const inventory of missingShaftInventories) {
    const managementNo = getInventoryManagementNo(inventory.etc);
    if (!managementNo) continue;
    const quantity = Math.max(1, Number(inventory.quantity ?? 1) || 1);
    try {
      await upsertLocalPurchase({
        zaicoId: null,
        purchaseNum: managementNo,
        status: "ordered",
        itemsJson: JSON.stringify([
          {
            id: 0,
            inventory_id: inventory.id,
            title: inventory.title,
            quantity: String(quantity),
            unit_price: inventory.unitPrice ?? null,
            etc: managementNo,
            status: "ordered",
            category: inventory.category ?? null,
          },
        ]),
        localInventoryId: inventory.id,
        title: inventory.title,
        category: inventory.category ?? null,
        quantity,
        unitPrice: inventory.unitPrice ?? null,
        managementNo,
        purchaseDate: getInventoryEtcPart(inventory.etc, 1) || null,
        receivedDate: null,
        supplierUrl: inventory.supplierUrl ?? null,
        supplierName: inventory.supplierName ?? null,
      });
      repaired = true;
    } catch (error) {
      console.warn("[inventory] failed to backfill shaft purchase", {
        inventoryId: inventory.id,
        managementNo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return repaired ? getLocalPurchases() : localPurchaseRows;
}
