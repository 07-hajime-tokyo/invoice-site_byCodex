import type { LocalPurchaseWithLabels as LocalPurchaseRow } from "../db";
import { localPurchaseItems, getPurchaseItemManagementNo } from "./items";

export function localPurchaseMatchesInventoryLabel(
  row: LocalPurchaseRow,
  localInventoryId: number | null,
  managementNo: string
): boolean {
  const inventoryId = Number(localInventoryId);
  if (!Number.isFinite(inventoryId)) return false;
  return localPurchaseItems(row).some(item => {
    const itemInventoryId = Number(
      item.inventory_id ?? item.inventoryId ?? row.localInventoryId
    );
    if (!Number.isFinite(itemInventoryId) || itemInventoryId !== inventoryId)
      return false;
    const itemManagementNo = getPurchaseItemManagementNo(row, item);
    return (
      !managementNo || !itemManagementNo || itemManagementNo === managementNo
    );
  });
}
