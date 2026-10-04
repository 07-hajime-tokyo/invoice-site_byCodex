import { getItemLabels } from "./purchaseItems";
import type { PurchaseRow } from "./dataTypes";

export function purchaseRowInventoryId(row: PurchaseRow): number | null {
  for (const label of getItemLabels(row.purchase_items)) {
    const id = Number(label.localInventoryId);
    if (Number.isFinite(id) && id > 0) return id;
  }
  for (const item of row.purchase_items) {
    const id = Number(item.inventory_id);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}
